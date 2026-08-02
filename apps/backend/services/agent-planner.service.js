const { aiGenerate, tryParseJson, getAiModel } = require('./ollama.service');
const { validateMedicationFidelity } = require('./agent-policy.service');

const GENERIC_WARNING =
  'Seek urgent in-person care if symptoms suddenly become severe, breathing becomes difficult, the patient faints, or there is severe bleeding.';

function clean(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function ensureSentence(value) {
  const text = clean(value);
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function formatIstDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return `${date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  })}, ${date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  })} IST`;
}

function buildNoShowFallback(context) {
  const patientName = clean(context.patient?.fullName, 'Patient');
  const doctorName = clean(context.doctor?.fullName, 'Doctor');
  const slotLabels = (context.availableSlots || []).map((slot) => formatIstDateTime(slot.startAt));
  const slotText = slotLabels.length ? slotLabels.join(', ') : 'No new slots are currently available';

  return {
    summary: `Recovery plan for a missed appointment with Dr. ${doctorName}.`,
    patientMessage:
      `Namaste ${patientName}. We could not connect for your consultation with Dr. ${doctorName}. ` +
      `Available times: ${slotText}. Use the rebooking link or reply if you need help.`,
    rationale: ['The appointment is marked as no-show.', `${slotLabels.length} future slot(s) were found.`],
    availableSlotLabels: slotLabels,
    safetyNotes: ['This message does not provide medical advice.', 'Patient confirmation is required before rebooking.'],
    fallbackUsed: true,
    model: 'deterministic-fallback'
  };
}

function buildPostVisitFallback(context) {
  const prescription = context.prescription || {};
  const items = Array.isArray(prescription.items) ? prescription.items : [];
  const followUpLabel = prescription.followUpAt ? formatIstDateTime(prescription.followUpAt) : 'No follow-up date was recorded.';
  const medicationExplanation = items.map((item) => {
    const name = clean(item.name, 'Medicine');
    const dosage = clean(item.dosage, 'as prescribed');
    const frequency = clean(item.frequency, 'as prescribed');
    const duration = clean(item.duration, 'as prescribed');
    return {
      name,
      dosage,
      frequency,
      duration,
      plainInstruction: `Take ${name} exactly as prescribed: ${dosage}, ${frequency}, for ${duration}.`
    };
  });

  return {
    summary: 'Post-consultation follow-up plan prepared from the doctor-authored prescription.',
    patientFriendlySummary: [
      prescription.diagnosis ? ensureSentence(`Diagnosis noted by the doctor: ${prescription.diagnosis}`) : '',
      prescription.instructions ? ensureSentence(`Doctor instructions: ${prescription.instructions}`) : '',
      prescription.followUpAt ? `Follow-up: ${followUpLabel}.` : 'Follow-up: No follow-up date was recorded.'
    ]
      .filter(Boolean)
      .join(' '),
    medicationExplanation,
    nextSteps: ['Follow the prescription exactly.', 'Use the follow-up date written by the doctor.'],
    warningSigns: [GENERIC_WARNING],
    fallbackUsed: true,
    model: 'deterministic-fallback'
  };
}

function noShowActions(context, plan) {
  return [
    {
      actionKey: 'queue_recovery_message',
      toolName: 'queue_no_show_recovery_message',
      title: 'Queue no-show recovery message',
      description: 'Save an outbound recovery message in the patient consultation thread.',
      arguments: {
        appointmentId: context.appointment.id,
        body: plan.patientMessage,
        metadata: {
          type: 'agent_no_show_recovery',
          quickRebookPath: context.quickRebookPath,
          offeredSlotIds: (context.availableSlots || []).map((slot) => slot.id)
        }
      },
      riskLevel: 'high',
      requiresApproval: true
    }
  ];
}

function postVisitMessageBody(plan) {
  const medicineLines = (plan.medicationExplanation || [])
    .map((item) => `- ${item.name}: ${item.dosage}, ${item.frequency}, for ${item.duration}. ${item.plainInstruction}`)
    .join('\n');
  return [
    'This is a follow-up summary of the doctor-authored care plan. Follow the prescription exactly.',
    plan.patientFriendlySummary,
    medicineLines ? `Medicines:\n${medicineLines}` : '',
    (plan.nextSteps || []).length ? `Next steps:\n${plan.nextSteps.map((step) => `- ${step}`).join('\n')}` : '',
    (plan.warningSigns || []).length ? `Safety note: ${plan.warningSigns.join(' ')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

function postVisitActions(context, plan) {
  return [
    {
      actionKey: 'queue_post_visit_summary',
      toolName: 'queue_post_visit_summary',
      title: 'Queue patient follow-up summary',
      description: 'Save a patient-facing follow-up summary in the external consultation thread.',
      arguments: {
        appointmentId: context.appointment.id,
        body: postVisitMessageBody(plan),
        metadata: {
          type: 'agent_post_visit_summary',
          prescriptionId: context.prescription?.id || null
        }
      },
      riskLevel: 'high',
      requiresApproval: true
    },
    {
      actionKey: 'schedule_refill_reminder',
      toolName: 'schedule_refill_reminder',
      title: 'Schedule or refresh refill reminder',
      description: 'Refresh the existing refill reminder job for the doctor-authored follow-up date.',
      arguments: {
        appointmentId: context.appointment.id
      },
      riskLevel: 'medium',
      requiresApproval: true
    }
  ];
}

async function planNoShowRecovery(context, input = {}) {
  const fallback = buildNoShowFallback(context);
  try {
    const promptContext = {
      patientDisplayName: context.patient?.fullName || 'Patient',
      doctorName: context.doctor?.fullName || 'Doctor',
      language: input.preferredLanguage || context.patient?.language || 'English',
      appointmentStatus: context.appointment.status,
      availableSlotLabels: fallback.availableSlotLabels,
      quickRebookPath: context.quickRebookPath,
      priorNoShowCount: context.priorNoShowCount
    };
    const text = await aiGenerate({
      systemPrompt:
        'You are a care-coordination drafting assistant inside a telemedicine workflow. Return one valid JSON object with exactly these keys: summary (string), patientMessage (string), rationale (array of strings), safetyNotes (array of strings). Do not diagnose or provide treatment. Draft a concise, respectful recovery message for a missed appointment. Use only supplied names, appointment context and available time labels. Do not claim a slot is booked. Ask the patient to confirm or use the provided rebooking path.',
      userPrompt: JSON.stringify(promptContext),
      temperature: 0.2,
      maxTokens: 700
    });
    const parsed = tryParseJson(text);
    if (!parsed || !clean(parsed.patientMessage) || !clean(parsed.summary)) throw new Error('Invalid model plan.');
    const plan = {
      ...fallback,
      summary: clean(parsed.summary, fallback.summary).slice(0, 1000),
      patientMessage: clean(parsed.patientMessage, fallback.patientMessage).slice(0, 1600),
      rationale: Array.isArray(parsed.rationale) ? parsed.rationale.map((item) => clean(item)).filter(Boolean).slice(0, 5) : fallback.rationale,
      safetyNotes: Array.isArray(parsed.safetyNotes)
        ? parsed.safetyNotes.map((item) => clean(item)).filter(Boolean).slice(0, 5)
        : fallback.safetyNotes,
      fallbackUsed: false,
      model: getAiModel()
    };
    return { plan, actions: noShowActions(context, plan) };
  } catch (error) {
    return { plan: { ...fallback, error: clean(error.message).slice(0, 300) }, actions: noShowActions(context, fallback) };
  }
}

async function planPostVisitFollowUp(context, input = {}) {
  const fallback = buildPostVisitFallback(context);
  try {
    const prescriptionItems = Array.isArray(context.prescription?.items) ? context.prescription.items : [];
    const text = await aiGenerate({
      systemPrompt:
        'You are a clinical communication drafting assistant. Return one valid JSON object with exactly these keys: patientFriendlySummary (string), medicationExplanation (array of objects with plainInstruction strings), nextSteps (array of strings), warningSigns (array of strings). You may simplify information already written by the doctor, but must not add, remove or change medicines, dosage, frequency, duration, diagnosis or follow-up timing. Do not diagnose. Do not recommend new treatment. All output is a draft requiring clinician approval.',
      userPrompt: JSON.stringify({
        language: input.preferredLanguage || context.patient?.language || 'English',
        diagnosis: context.prescription?.diagnosis || '',
        instructions: context.prescription?.instructions || '',
        followUpAt: context.prescription?.followUpAt || null,
        medicineCount: prescriptionItems.length,
        medicines: prescriptionItems.map((item, index) => ({
          index,
          name: item.name,
          dosage: item.dosage,
          frequency: item.frequency,
          duration: item.duration
        }))
      }),
      temperature: 0.2,
      maxTokens: 700
    });
    const parsed = tryParseJson(text);
    if (!parsed || !clean(parsed.patientFriendlySummary)) throw new Error('Invalid model plan.');
    const generatedInstructions = Array.isArray(parsed.medicationExplanation) ? parsed.medicationExplanation : [];
    const merged = prescriptionItems.map((item, index) => ({
      name: clean(item.name),
      dosage: clean(item.dosage),
      frequency: clean(item.frequency),
      duration: clean(item.duration),
      plainInstruction: clean(generatedInstructions[index]?.plainInstruction, fallback.medicationExplanation[index]?.plainInstruction)
    }));
    validateMedicationFidelity(prescriptionItems, merged);
    const plan = {
      ...fallback,
      patientFriendlySummary: clean(parsed.patientFriendlySummary, fallback.patientFriendlySummary).slice(0, 2000),
      medicationExplanation: merged,
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map((item) => clean(item)).filter(Boolean).slice(0, 6) : fallback.nextSteps,
      warningSigns: [GENERIC_WARNING],
      fallbackUsed: false,
      model: getAiModel()
    };
    return { plan, actions: postVisitActions(context, plan) };
  } catch (error) {
    return { plan: { ...fallback, error: clean(error.message).slice(0, 300) }, actions: postVisitActions(context, fallback) };
  }
}

module.exports = {
  GENERIC_WARNING,
  ensureSentence,
  formatIstDateTime,
  buildNoShowFallback,
  buildPostVisitFallback,
  validateMedicationFidelity,
  planNoShowRecovery,
  planPostVisitFollowUp
};
