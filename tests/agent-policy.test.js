const {
  assertCanGenerateNoShowPlan
} = require('../apps/backend/services/agent-policy.service');

const assignedDoctor = {
  id: 'doctor-1',
  role: 'doctor'
};

const admin = {
  id: 'admin-1',
  role: 'admin'
};

function appointment(overrides = {}) {
  return {
    id: 'appointment-1',
    doctorId: assignedDoctor.id,
    patientId: 'patient-1',
    status: 'booked',
    noShowOccurrenceId: null,
    noShowVersion: 0,
    ...overrides
  };
}

describe('no-show recovery policy', () => {
  it('allows the assigned doctor to create a ticket for a booked appointment', () => {
    expect(() => assertCanGenerateNoShowPlan(assignedDoctor, appointment())).not.toThrow();
  });

  it('allows an administrator to plan an appointment currently marked no-show', () => {
    expect(() => assertCanGenerateNoShowPlan(admin, appointment({ status: 'no_show' }))).not.toThrow();
  });

  it('keeps a recorded no-show ticket eligible after the appointment is closed', () => {
    expect(() => assertCanGenerateNoShowPlan(admin, appointment({
      status: 'completed',
      noShowOccurrenceId: 'occurrence-1',
      noShowVersion: 1
    }))).not.toThrow();
  });

  it('rejects an ordinary completed appointment with no recorded no-show occurrence', () => {
    expect(() => assertCanGenerateNoShowPlan(admin, appointment({ status: 'completed' }))).toThrow(
      expect.objectContaining({
        status: 409,
        code: 'INVALID_AGENT_STATE'
      })
    );
  });

  it('rejects a cancelled appointment even when an old occurrence identifier remains', () => {
    expect(() => assertCanGenerateNoShowPlan(admin, appointment({
      status: 'cancelled',
      noShowOccurrenceId: 'occurrence-1',
      noShowVersion: 1
    }))).toThrow(
      expect.objectContaining({
        status: 409,
        code: 'INVALID_AGENT_STATE'
      })
    );
  });

  it('still rejects a doctor who is not assigned to the appointment', () => {
    expect(() => assertCanGenerateNoShowPlan(
      { id: 'doctor-2', role: 'doctor' },
      appointment({ status: 'no_show' })
    )).toThrow(
      expect.objectContaining({
        status: 403,
        code: 'AGENT_POLICY_DENIED'
      })
    );
  });
});
