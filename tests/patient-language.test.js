const { LANGUAGE_DEFINITIONS, resolvePatientLanguage } = require('../apps/backend/services/patient-language.service');
const { TEMPLATES, buildNoShowLocalizedTemplate } = require('../apps/backend/locales/agent-messages');
const { REBOOK_CTA_TEXT } = require('../apps/backend/locales/agent-messages/rebook-cta');
const { validateLocalizedAgentDraft } = require('../apps/backend/services/agent-language-validation.service');

describe('patient language and localized no-show drafts', () => {
  test.each(Object.keys(LANGUAGE_DEFINITIONS))('%s resolves and has a reviewed template', (code) => {
    const language = resolvePatientLanguage({ language: code });
    const safeRebookText = REBOOK_CTA_TEXT[code] || REBOOK_CTA_TEXT.hi;
    const template = buildNoShowLocalizedTemplate(language, { patientName: 'Asha', doctorName: 'Ravi', slotList: '05 Aug', rebookUrl: safeRebookText });
    expect(language.code).toBe(code);
    expect(TEMPLATES[code]).toBeDefined();
    expect(template.notificationTitle).toBeTruthy();
    expect(template.notificationBody).toContain(safeRebookText);
    expect(template.notificationBody).toContain('05 Aug');
  });

  test.each([
    [null, 'hi'], ['', 'hi'], ['   ', 'hi'], ['not-a-language', 'hi'], ['fr-FR', 'hi'], ['Tamil', 'ta'], ['ta-IN', 'ta'], ['தமிழ்', 'ta'], ['Urdu', 'ur'], ['Oriya', 'or'], ['Meitei', 'mni']
  ])('%s resolves to %s', (value, expected) => {
    expect(resolvePatientLanguage({ language: value }).code).toBe(expected);
  });

  test('invalid Tamil model output fails instead of being sent in English', () => {
    expect(() => validateLocalizedAgentDraft({
      draft: { notificationTitle: 'Missed appointment', patientMessage: 'Please choose a new appointment time using the button below.' },
      language: resolvePatientLanguage({ language: 'ta' }),
      quickRebookPath: '/book?appointment=1'
    })).toThrow('Tamil');
  });

  test('valid Urdu output reports RTL', () => {
    const language = resolvePatientLanguage({ language: 'Urdu' });
    const draft = buildNoShowLocalizedTemplate(language, { patientName: 'Asha', doctorName: 'Ravi', rebookUrl: REBOOK_CTA_TEXT.ur });
    expect(validateLocalizedAgentDraft({ draft, language, quickRebookPath: '/book?appointment=1' }).direction).toBe('rtl');
  });
});
