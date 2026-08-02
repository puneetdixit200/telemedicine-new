jest.mock('../apps/backend/services/ollama.service', () => ({
  aiGenerate: jest.fn(),
  tryParseJson: jest.fn((text) => {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }),
  getAiModel: jest.fn(() => 'openai/gpt-oss-120b')
}));

const {
  buildNoShowFallback,
  buildPostVisitFallback,
  validateMedicationFidelity,
  ensureSentence,
  planNoShowRecovery
} = require('../apps/backend/services/agent-planner.service');
const { aiGenerate } = require('../apps/backend/services/ollama.service');

describe('agent planner deterministic safety', () => {
  afterEach(() => jest.clearAllMocks());

  it('builds a no-show fallback without claiming delivery or booking a slot', () => {
    const plan = buildNoShowFallback({
      appointment: { id: 'appt-1' },
      patient: { fullName: 'Asha' },
      doctor: { fullName: 'Ravi' },
      availableSlots: [{ id: 'slot-1', startAt: '2026-07-30T05:00:00.000Z' }],
      quickRebookPath: '/book?doctorId=doc-1&rebook=1'
    });

    expect(plan).toMatchObject({
      fallbackUsed: true,
      model: 'deterministic-fallback'
    });
    expect(plan.patientMessage).toContain('Use the rebooking link or reply if you need help.');
    expect(plan.patientMessage).not.toMatch(/booked|delivered|diagnos/i);
  });

  it('copies medicine fields from the prescription in post-visit fallback', () => {
    const plan = buildPostVisitFallback({
      appointment: { id: 'appt-1' },
      patient: { fullName: 'Asha' },
      doctor: { fullName: 'Ravi' },
      prescription: {
        diagnosis: 'Doctor-authored diagnosis',
        instructions: 'Drink water.',
        followUpAt: '2026-08-05T04:30:00.000Z',
        items: [
          {
            name: 'Medicine A',
            dosage: '1 tablet',
            frequency: 'twice daily',
            duration: '5 days'
          }
        ]
      },
      availableSlots: []
    });

    expect(plan.medicationExplanation).toEqual([
      {
        name: 'Medicine A',
        dosage: '1 tablet',
        frequency: 'twice daily',
        duration: '5 days',
        plainInstruction: 'Take Medicine A exactly as prescribed: 1 tablet, twice daily, for 5 days.'
      }
    ]);
    expect(plan.patientFriendlySummary).not.toContain('..');
    expect(plan.warningSigns).toContain(
      'Seek urgent in-person care if symptoms suddenly become severe, breathing becomes difficult, the patient faints, or there is severe bleeding.'
    );
  });

  it('rejects generated medication changes', () => {
    expect(() =>
      validateMedicationFidelity(
        [{ name: 'Medicine A', dosage: '1 tablet', frequency: 'twice daily', duration: '5 days' }],
        [{ name: 'Medicine B', dosage: '1 tablet', frequency: 'twice daily', duration: '5 days' }]
      )
    ).toThrow(/Medication mismatch/);
  });

  it.each([
    ['already punctuated', 'Follow the medicine exactly as prescribed.', 'Follow the medicine exactly as prescribed.'],
    ['missing punctuation', 'Follow the medicine exactly as prescribed', 'Follow the medicine exactly as prescribed.'],
    ['empty', '', ''],
    ['exclamation', 'Follow the medicine exactly as prescribed!', 'Follow the medicine exactly as prescribed!'],
    ['question', 'Follow the medicine exactly as prescribed?', 'Follow the medicine exactly as prescribed?']
  ])('normalizes sentence punctuation for %s', (_label, input, expected) => {
    expect(ensureSentence(input)).toBe(expected);
  });

  it('uses a valid OpenRouter JSON draft without fallback', async () => {
    aiGenerate.mockResolvedValue(
      JSON.stringify({
        summary: 'A respectful missed-visit recovery draft.',
        patientMessage: 'Please confirm a new consultation time.',
        rationale: ['The appointment was marked no-show.'],
        safetyNotes: ['No medical advice is included.']
      })
    );

    const result = await planNoShowRecovery(
      {
        appointment: { id: 'appt-1', status: 'no_show' },
        patient: { fullName: 'Asha', language: 'English' },
        doctor: { fullName: 'Ravi' },
        availableSlots: [],
        quickRebookPath: '/book?doctorId=doc-1',
        priorNoShowCount: 0
      },
      {}
    );

    expect(result.plan).toMatchObject({
      fallbackUsed: false,
      model: 'openai/gpt-oss-120b',
      patientMessage: 'Please confirm a new consultation time.'
    });
  });

  it('falls back when the configured provider fails', async () => {
    aiGenerate.mockRejectedValue(new Error('provider unavailable'));

    const result = await planNoShowRecovery(
      {
        appointment: { id: 'appt-1', status: 'no_show' },
        patient: { fullName: 'Asha' },
        doctor: { fullName: 'Ravi' },
        availableSlots: [],
        quickRebookPath: '/book?doctorId=doc-1',
        priorNoShowCount: 0
      },
      {}
    );

    expect(result.plan).toMatchObject({ fallbackUsed: true, model: 'deterministic-fallback' });
    expect(result.plan.error).toBe('provider unavailable');
  });
});
