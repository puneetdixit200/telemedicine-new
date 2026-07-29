const ALLOWED_TOOLS = {
  no_show_recovery: new Set(['queue_no_show_recovery_message']),
  post_visit_follow_up: new Set(['queue_post_visit_summary', 'schedule_refill_reminder'])
};

function policyError(message, status = 403, code = 'AGENT_POLICY_DENIED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function assertCanManageAppointment(user, appointment) {
  if (!user) throw policyError('Authentication required.', 401, 'UNAUTHORIZED');
  if (!appointment) throw policyError('Appointment not found.', 404, 'APPOINTMENT_NOT_FOUND');
  const isDoctorOwner = user.role === 'doctor' && user.id === appointment.doctorId;
  const isAdmin = user.role === 'admin';
  if (!isDoctorOwner && !isAdmin) {
    throw policyError('Only the assigned doctor or an administrator can manage this agent workflow.');
  }
}

function assertCanGenerateNoShowPlan(user, appointment) {
  assertCanManageAppointment(user, appointment);
  if (!['booked', 'no_show'].includes(appointment.status)) {
    throw policyError('No-show recovery can only be planned for booked or no-show appointments.', 409, 'INVALID_AGENT_STATE');
  }
}

function assertCanGeneratePostVisitPlan(user, appointment) {
  assertCanManageAppointment(user, appointment);
  if (appointment.status !== 'completed') {
    throw policyError('Post-visit follow-up requires a completed appointment.', 409, 'INVALID_AGENT_STATE');
  }
  const items = Array.isArray(appointment.prescription?.items) ? appointment.prescription.items : [];
  if (!appointment.prescription || items.length === 0) {
    throw policyError('Post-visit follow-up requires a prescription with at least one medicine.', 409, 'PRESCRIPTION_REQUIRED');
  }
}

function assertCanApproveAgentRun(user, run) {
  assertCanManageAppointment(user, run?.appointment);
}

function assertAllowedTool(agentType, toolName) {
  if (!ALLOWED_TOOLS[agentType]?.has(toolName)) {
    throw policyError('Agent action tool is not allowed for this workflow.', 400, 'AGENT_TOOL_NOT_ALLOWED');
  }
}

function validateMedicationFidelity(prescriptionItems, generatedItems) {
  const originals = Array.isArray(prescriptionItems) ? prescriptionItems : [];
  const generated = Array.isArray(generatedItems) ? generatedItems : [];
  if (originals.length !== generated.length) {
    throw policyError('Medication mismatch: generated item count changed.', 400, 'MEDICATION_FIDELITY_FAILED');
  }

  originals.forEach((item, index) => {
    const generatedItem = generated[index] || {};
    ['name', 'dosage', 'frequency', 'duration'].forEach((field) => {
      if (normalizeText(item[field]) !== normalizeText(generatedItem[field])) {
        throw policyError(`Medication mismatch: ${field} changed at item ${index + 1}.`, 400, 'MEDICATION_FIDELITY_FAILED');
      }
    });
  });
}

module.exports = {
  ALLOWED_TOOLS,
  assertCanManageAppointment,
  assertCanGenerateNoShowPlan,
  assertCanGeneratePostVisitPlan,
  assertCanApproveAgentRun,
  assertAllowedTool,
  validateMedicationFidelity,
  policyError
};
