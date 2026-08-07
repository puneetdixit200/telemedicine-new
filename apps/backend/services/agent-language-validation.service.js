const { LANGUAGE_DEFINITIONS, resolvePatientLanguage } = require('./patient-language.service');

const SCRIPT_RANGES = {
  Bengali: /[\u0980-\u09ff]/g,
  'Bengali-Assamese': /[\u0980-\u09ff]/g,
  Devanagari: /[\u0900-\u097f]/g,
  Gujarati: /[\u0a80-\u0aff]/g,
  Kannada: /[\u0c80-\u0cff]/g,
  'Perso-Arabic': /[\u0600-\u06ff\u0750-\u077f]/g,
  Malayalam: /[\u0d00-\u0d7f]/g,
  'Meetei Mayek': /[\uab00-\uab2f]/g,
  OlChiki: /[\u1c50-\u1c7f]/g,
  Odia: /[\u0b00-\u0b7f]/g,
  Gurmukhi: /[\u0a00-\u0a7f]/g,
  Tamil: /[\u0b80-\u0bff]/g,
  Telugu: /[\u0c00-\u0c7f]/g,
  Latin: /[A-Za-z]/g
};

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const TECHNICAL_REFERENCE_PATTERN = /(?:https?:\/\/|\/\/|\/book\?|\b(?:doctorId|appointmentId|fromAppointmentId|runId|traceId|actionId|messageDraftId)=)/i;

function compact(value) {
  return String(value || '').normalize('NFC').trim();
}

function withoutImmutableTokens(value, tokens = []) {
  let output = compact(value);
  for (const token of tokens.filter(Boolean)) output = output.split(String(token)).join(' ');
  return output.replace(/https?:\/\/[^\s)]+/gi, ' ').replace(/[\d\p{P}\p{Z}]/gu, ' ');
}

function scriptRatio(text, script) {
  const letters = String(text || '').match(/[\p{L}]/gu) || [];
  if (!letters.length) return 0;
  const range = SCRIPT_RANGES[script];
  if (!range) return 1;
  const matches = String(text || '').match(range) || [];
  return matches.length / letters.length;
}

function languageValidationError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function hasPatientFacingTechnicalReference(value, trustedNavigationPath = '') {
  const text = compact(value);
  if (!text) return false;
  if (trustedNavigationPath && text.includes(String(trustedNavigationPath))) return true;
  return TECHNICAL_REFERENCE_PATTERN.test(text) || UUID_PATTERN.test(text);
}

function validateLocalizedAgentDraft({ draft, language, quickRebookPath, availableSlotLabels = [], immutableTokens = [] }) {
  const resolved = resolvePatientLanguage(language);
  if (!LANGUAGE_DEFINITIONS[resolved.code]) throw languageValidationError('LOCALIZED_LANGUAGE_UNSUPPORTED', 'The requested patient language is not supported.');
  const title = compact(draft?.notificationTitle || draft?.title);
  const body = compact(draft?.patientMessage || draft?.notificationBody);
  if (!title || !body) throw languageValidationError('LOCALIZED_OUTPUT_EMPTY', 'Localized notification title and body are required.');
  if (hasPatientFacingTechnicalReference(`${title}\n${body}`, quickRebookPath)) {
    throw languageValidationError('PATIENT_CONTENT_REFERENCE_FOUND', 'Patient-facing notification content must not expose URLs, route parameters, UUIDs, or internal references.');
  }
  for (const slot of availableSlotLabels) {
    if (slot && !body.includes(String(slot))) throw languageValidationError('LOCALIZED_SLOT_CHANGED', 'Available appointment times must be preserved.');
  }
  if (/\b(already booked|booked successfully|diagnos|take|prescrib|medicine|treatment|cure)\b/i.test(body) && resolved.code !== 'en') {
    throw languageValidationError('LOCALIZED_UNSAFE_CONTENT', 'The patient draft contains unsupported booking or medical language.');
  }
  if (title.length > 240 || body.length > 2400) throw languageValidationError('LOCALIZED_OUTPUT_TOO_LONG', 'The localized notification is too long.');
  const checkText = withoutImmutableTokens(`${title} ${body}`, [...immutableTokens, ...availableSlotLabels]);
  if (resolved.code !== 'en' && scriptRatio(checkText, resolved.script) < 0.12) {
    throw languageValidationError('LOCALIZED_WRONG_SCRIPT', `The draft does not contain enough ${resolved.script} text.`);
  }
  return { ...resolved, title, body, valid: true };
}

module.exports = {
  validateLocalizedAgentDraft,
  scriptRatio,
  hasPatientFacingTechnicalReference,
  UUID_PATTERN,
  TECHNICAL_REFERENCE_PATTERN
};
