const {
  buildNoShowFallback,
  buildPostVisitFallback,
  validateMedicationFidelity
} = require('../apps/backend/services/agent-planner.service');

describe('agent planner deterministic safety', () => {
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
});
