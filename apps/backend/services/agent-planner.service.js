const { aiGenerate, tryParseJson, getAiModel } = require('./ollama.service');
const { validateMedicationFidelity } = require('./agent-policy.service');
const { resolvePatientLanguage } = require('./patient-language.service');
const { buildNoShowLocalizedTemplate } = require('../locales/agent-messages');
const { getRebookCtaText } = require('../locales/agent-messages/rebook-cta');
const { validateLocalizedAgentDraft } = require('./agent-language-validation.service');

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

function normalizeDoctorName(value) {
  return clean(value, 'Doctor')
    .replace(/^\s*(?:dr\.?|doctor)\s+/i, '')
    .trim() || 'Doctor';
}

function formatIstDateTime(value, locale = 'en-IN') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return `${date.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  })}, ${date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  })} IST`;
}

function buildNoShowFallback(context) {
  const patientName = clean(context.patient?.fullName, 'Patient');
  const doctorName = normalizeDoctorName(context.doctor?.fullName);
  const language = context.patientLanguage || resolvePatientLanguage(context.patient);
  const slotLabels = (context.availableSlots || []).map((slot) => formatIstDateTime(slot.startAt, language.locale));
  const slotText = slotLabels.join(', ');
  const localized = buildNoShowLocalizedTemplate(language, {
    patientName,
    doctorName,
    slotList: slotText,
    rebookUrl: getRebookCtaText(language.code)
  });

  return {
    summary: `Recovery plan for a missed appointment with Dr. ${doctorName}.`,
    notificationTitle: localized.notificationTitle,
    patientMessage: localized.notificationBody,
    rationale: ['The appointment is marked as no-show.', `${slotLabels.length} future slot(s) were found.`],
    availableSlotLabels: slotLabels,
    safetyNotes: ['This message does not provide medical advice.', 'Patient confirmation is required before rebooking.'],
    fallbackUsed: true,
    model: 'deterministic-fallback',
    provider: 'deterministic',
    generationSource: localized.generationSource,
    languageCode: language.code,
    languageName: language.name,
    languageNativeName: language.nativeName,
    languageScript: language.script,
    languageDirection: language.direction,
    languageSource: language.source,
    languageFallbackUsed: language.fallbackUsed
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
        title: plan.notificationTitle,
        metadata: {
          type: 'agent_no_show_recovery',
          quickRebookPath: context.quickRebookPath,
          offeredSlotIds: (context.availableSlots || []).map((slot) => slot.id),
          availableSlotLabels: plan.availableSlotLabels || [],
          languageCode: plan.languageCode,
          languageName: plan.languageName,
          languageScript: plan.languageScript,
          languageDirection: plan.languageDirection,
          languageSource: plan.languageSource,
          languageFallbackUsed: plan.languageFallbackUsed,
          generationSource: plan.generationSource
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
  const language = context.patientLanguage || resolvePatientLanguage(context.patient);
  const promptContext = {
    patientDisplayName: context.patient?.fullName || 'Patient',
    doctorName: normalizeDoctorName(context.doctor?.fullName),
    targetLanguageCode: language.code,
    targetLanguageName: language.name,
    targetLanguageNativeName: language.nativeName,
    targetScript: language.script,
    targetDirection: language.direction,
    appointmentStatus: context.appointment.status,
    availableSlotLabels: fallback.availableSlotLabels,
    hasRebookingAction: true,
    priorNoShowCount: context.priorNoShowCount
  };
  const baseSystemPrompt = 'You are a care-coordination drafting assistant inside a telemedicine workflow. Return one valid JSON object with exactly these keys: adminSummary (string), notificationTitle (string), patientMessage (string), rationale (array of strings), safetyNotes (array of strings). Write notificationTitle and patientMessage entirely in the requested target language and preferred native script. Do not write patient-facing fields in English unless the target language is English. Patient-facing fields must not contain URLs, route paths, query parameters, UUIDs, database identifiers, appointment IDs, doctor IDs, run IDs, trace IDs, action IDs, or reference numbers. The application provides a separate trusted rebooking button, so tell the patient to use the button below. Names and exact date/time values may remain unchanged. Do not mix English headings into non-English patient-facing text. Do not diagnose, recommend treatment, or claim a slot has been booked. Return valid JSON.';
  const failureCategory = (error) => {
    if (!error) return 'invalid_schema';
    if (error.status === 504) return 'PROVIDER_TIMEOUT';
    if (error.status === 502) return 'PROVIDER_HTTP_ERROR';
    if (error.status === 503) return 'PROVIDER_UNAVAILABLE';
    if (error.code === 'LOCALIZED_WRONG_SCRIPT') return 'wrong_language_or_script';
    if (error.code === 'PATIENT_CONTENT_REFERENCE_FOUND') return 'patient_content_reference_found';
    if (error.code === 'LOCALIZED_SLOT_CHANGED') return 'slot_labels_changed';
    if (error.code === 'LOCALIZED_OUTPUT_EMPTY') return 'missing_required_fields';
    if (error.code === 'LOCALIZED_UNSAFE_CONTENT') return 'unsafe_content';
    return error.code || 'invalid_schema';
  };
  const buildPrompt = (correction) => correction
    ? `${baseSystemPrompt} Your previous response failed validation for: ${correction}. Return one corrected JSON object only. Keep all patient-facing fields free of technical references and preserve the supplied slot labels exactly.`
    : baseSystemPrompt;
  const buildUserPrompt = (correction) => JSON.stringify(correction ? { ...promptContext, validationFailure: correction } : promptContext);
  const parseAndValidate = (text) => {
    const parsed = tryParseJson(text);
    console.log('[agent-planner] no-show model response shape', { model: getAiModel(), responseLength: String(text || '').length, keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [] });
    if (!parsed) {
      const error = new Error('Invalid model JSON.');
      error.code = 'INVALID_JSON';
      throw error;
    }
    if (!clean(parsed.patientMessage) || !clean(parsed.notificationTitle) || !clean(parsed.adminSummary || parsed.summary)) {
      const error = new Error('Invalid model plan.');
      error.code = 'INVALID_MODEL_SCHEMA';
      throw error;
    }
    const plan = {
      ...fallback,
      summary: clean(parsed.adminSummary || parsed.summary, fallback.summary).slice(0, 1000),
      notificationTitle: clean(parsed.notificationTitle, fallback.notificationTitle).slice(0, 240),
      patientMessage: clean(parsed.patientMessage, fallback.patientMessage).slice(0, 1600),
      rationale: Array.isArray(parsed.rationale) ? parsed.rationale.map((item) => clean(item)).filter(Boolean).slice(0, 5) : fallback.rationale,
      safetyNotes: Array.isArray(parsed.safetyNotes) ? parsed.safetyNotes.map((item) => clean(item)).filter(Boolean).slice(0, 5) : fallback.safetyNotes,
      fallbackUsed: false,
      model: getAiModel(),
      provider: 'openrouter',
      generationSource: 'openrouter'
    };
    validateLocalizedAgentDraft({ draft: plan, language, quickRebookPath: context.quickRebookPath, availableSlotLabels: fallback.availableSlotLabels, immutableTokens: [patientNameToken(context.patient), doctorNameToken(context.doctor)] });
    return plan;
  };

  let firstFailure = null;
  let firstAttemptValid = false;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const text = await aiGenerate({ systemPrompt: buildPrompt(firstFailure && failureCategory(firstFailure)), userPrompt: buildUserPrompt(firstFailure && failureCategory(firstFailure)), temperature: 0.2, maxTokens: 700 });
      const plan = parseAndValidate(text);
      firstAttemptValid = attempt === 1;
      plan.aiMetadata = { attemptCount: attempt, firstAttemptValid, correctiveRetryUsed: attempt === 2, finalGenerationSource: 'openrouter', fallbackUsed: false, validationFailureCategory: firstFailure ? failureCategory(firstFailure) : null };
      return { plan, actions: noShowActions(context, plan) };
    } catch (error) {
      if (attempt === 1 && error && ![503, 502, 504].includes(error.status)) {
        firstFailure = error;
        continue;
      }
      const category = failureCategory(firstFailure || error);
      const plan = { ...fallback, error: clean(error.message).slice(0, 300), validationFailure: category, aiMetadata: { attemptCount: attempt, firstAttemptValid: false, correctiveRetryUsed: attempt === 2, finalGenerationSource: 'deterministic_localized_template', fallbackUsed: true, validationFailureCategory: category } };
      return { plan, actions: noShowActions(context, plan) };
    }
  }
  return { plan: { ...fallback, aiMetadata: { attemptCount: 2, firstAttemptValid: false, correctiveRetryUsed: true, finalGenerationSource: 'deterministic_localized_template', fallbackUsed: true, validationFailureCategory: 'invalid_schema' } }, actions: noShowActions(context, fallback) };
}

function patientNameToken(patient) { return clean(patient?.fullName); }
function doctorNameToken(doctor) { return normalizeDoctorName(doctor?.fullName); }

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
    console.log('[agent-planner] post-visit model response shape', {
      model: getAiModel(),
      responseLength: String(text || '').length,
      keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : []
    });
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
  normalizeDoctorName,
  formatIstDateTime,
  buildNoShowFallback,
  buildPostVisitFallback,
  validateMedicationFidelity,
  planNoShowRecovery,
  planPostVisitFollowUp
};
