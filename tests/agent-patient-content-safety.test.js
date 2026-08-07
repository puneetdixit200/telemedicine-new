const {
  validateLocalizedAgentDraft,
  hasPatientFacingTechnicalReference
} = require('../apps/backend/services/agent-language-validation.service');
const { resolvePatientLanguage } = require('../apps/backend/services/patient-language.service');
const { REBOOK_CTA_TEXT } = require('../apps/backend/locales/agent-messages/rebook-cta');

const quickRebookPath = '/book?doctorId=10000000-0000-4000-8000-000000000003&fromAppointmentId=20000000-0000-4000-8000-000000000004&rebook=1';

describe('patient-facing no-show content safety', () => {
  it('accepts a localized draft that keeps navigation out of visible text', () => {
    const result = validateLocalizedAgentDraft({
      draft: {
        notificationTitle: 'छूटी हुई अपॉइंटमेंट के लिए फॉलो-अप',
        patientMessage: `नमस्ते आशा। उपलब्ध समय: 10 जन॰ 2030, 11:30 am IST। ${REBOOK_CTA_TEXT.hi}`
      },
      language: resolvePatientLanguage('Hindi'),
      quickRebookPath,
      availableSlotLabels: ['10 जन॰ 2030, 11:30 am IST'],
      immutableTokens: ['आशा']
    });

    expect(result).toMatchObject({ code: 'hi', valid: true });
  });

  it.each([
    ['raw route', `कृपया यहां जाएं: ${quickRebookPath}`],
    ['query reference', 'doctorId=10000000-0000-4000-8000-000000000003'],
    ['standalone UUID', '10000000-0000-4000-8000-000000000003'],
    ['external URL', 'https://example.com/rebook']
  ])('rejects %s in visible patient content', (_label, patientMessage) => {
    expect(() => validateLocalizedAgentDraft({
      draft: {
        notificationTitle: 'छूटी हुई अपॉइंटमेंट',
        patientMessage
      },
      language: resolvePatientLanguage('Hindi'),
      quickRebookPath
    })).toThrow(/must not expose URLs, route parameters, UUIDs, or internal references/);
  });

  it('keeps every deterministic CTA reference-free', () => {
    for (const text of Object.values(REBOOK_CTA_TEXT)) {
      expect(text).toBeTruthy();
      expect(hasPatientFacingTechnicalReference(text, quickRebookPath)).toBe(false);
    }
  });
});
