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
  normalizeDoctorName,
  planNoShowRecovery
} = require('../apps/backend/services/agent-planner.service');
const { aiGenerate } = require('../apps/backend/services/ollama.service');

describe('agent planner deterministic safety', () => {
  afterEach(() => jest.clearAllMocks());

  it('builds a reference-free no-show fallback without claiming delivery or booking a slot', () => {
    const plan = buildNoShowFallback({
      appointment: { id: 'appt-1' },
      patient: { fullName: 'Asha' },
      doctor: { fullName: 'Dr. Ravi' },
      availableSlots: [{ id: 'slot-1', startAt: '2026-07-30T05:00:00.000Z' }],
      quickRebookPath: '/book?doctorId=10000000-0000-4000-8000-000000000003&rebook=1'
    });

    expect(plan).toMatchObject({
      fallbackUsed: true,
      model: 'deterministic-fallback',
      summary: 'Recovery plan for a missed appointment with Dr. Ravi.'
    });
    expect(plan.patientMessage).toContain('नीचे दिए गए बटन');
    expect(plan.patientMessage).not.toMatch(/\/book\?|doctorId=|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23}/i);
    expect(plan.patientMessage).not.toMatch(/booked|delivered|diagnos/i);
    expect(plan.patientMessage).not.toContain('डॉ. Dr.');
  });

  it.each([
    ['Dr. Ravi', 'Ravi'],
    ['Dr Ravi', 'Ravi'],
    ['Doctor Ravi', 'Ravi'],
    ['Ravi', 'Ravi']
  ])('normalizes doctor title for %s', (input, expected) => {
    expect(normalizeDoctorName(input)).toBe(expected);
  });

  it.each([
    ['English', 'en'], ['Bengali', 'bn'], ['Gujarati', 'gu'], ['Hindi', 'hi'], ['Kannada', 'kn'], ['Malayalam', 'ml'],
    ['Marathi', 'mr'], ['Nepali', 'ne'], ['Odia', 'or'], ['Punjabi', 'pa'], ['Tamil', 'ta'], ['Telugu', 'te'], ['Urdu', 'ur'], [undefined, 'hi']
  ])('uses the patient preferred language greeting for %s', (language, code) => {
    const plan = buildNoShowFallback({
      appointment: { id: 'appt-1' },
      patient: { fullName: 'Asha', language },
      doctor: { fullName: 'Ravi' },
      availableSlots: []
    });

    expect(plan.languageCode).toBe(code);
    expect(plan.patientMessage).toContain('Asha.');
    expect(plan.patientMessage).not.toMatch(/\/book\?|doctorId=|fromAppointmentId=/i);
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

  it('uses a valid reference-free OpenRouter JSON draft without fallback', async () => {
    aiGenerate.mockResolvedValue(
      JSON.stringify({
        adminSummary: 'A respectful missed-visit recovery draft.',
        notificationTitle: 'Missed appointment follow-up',
        patientMessage: 'Please confirm a new consultation time and use the button below to rebook.',
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
      patientMessage: 'Please confirm a new consultation time and use the button below to rebook.'
    });
    expect(result.actions[0].arguments.metadata.quickRebookPath).toBe('/book?doctorId=doc-1');
    expect(result.actions[0].arguments.body).not.toContain('/book?');
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
    expect(result.plan.patientMessage).not.toContain('/book?');
  });

  it('uses one corrective retry when the first response exposes a technical route', async () => {
    aiGenerate
      .mockResolvedValueOnce(JSON.stringify({
        adminSummary: 'Unsafe first draft.',
        notificationTitle: 'Missed appointment follow-up',
        patientMessage: 'Rebook here: /book?doctorId=doc-1',
        rationale: [],
        safetyNotes: []
      }))
      .mockResolvedValueOnce(JSON.stringify({
        adminSummary: 'Corrected draft.',
        notificationTitle: 'Missed appointment follow-up',
        patientMessage: 'Please use the button below to choose a new consultation time.',
        rationale: [],
        safetyNotes: []
      }));
    const result = await planNoShowRecovery({
      appointment: { id: 'appt-1', status: 'no_show' }, patient: { fullName: 'Asha', language: 'English' }, doctor: { fullName: 'Ravi' }, availableSlots: [], quickRebookPath: '/book?doctorId=doc-1', priorNoShowCount: 0
    });
    expect(aiGenerate).toHaveBeenCalledTimes(2);
    expect(result.plan).toMatchObject({ fallbackUsed: false, generationSource: 'openrouter', aiMetadata: { attemptCount: 2, firstAttemptValid: false, correctiveRetryUsed: true, finalGenerationSource: 'openrouter', validationFailureCategory: 'patient_content_reference_found' } });
    expect(result.plan.patientMessage).not.toContain('/book?');
  });

  it('uses a localized fallback after one invalid corrective retry', async () => {
    aiGenerate.mockResolvedValueOnce('not json').mockResolvedValueOnce('{}');
    const result = await planNoShowRecovery({
      appointment: { id: 'appt-1', status: 'no_show' }, patient: { fullName: 'Asha', language: 'Tamil' }, doctor: { fullName: 'Ravi' }, availableSlots: [], quickRebookPath: '/book?doctorId=doc-1', priorNoShowCount: 0
    });
    expect(aiGenerate).toHaveBeenCalledTimes(2);
    expect(result.plan).toMatchObject({ fallbackUsed: true, model: 'deterministic-fallback', generationSource: 'deterministic_localized_template', languageCode: 'ta', aiMetadata: { attemptCount: 2, correctiveRetryUsed: true, finalGenerationSource: 'deterministic_localized_template', fallbackUsed: true, validationFailureCategory: 'INVALID_JSON' } });
    expect(result.plan.patientMessage).toMatch(/தமிழ்|வணக்கம்|பொத்தானை/);
    expect(result.plan.patientMessage).not.toContain('/book?');
  });
});
