const LANGUAGE_DEFINITIONS = Object.freeze({
  en: { code: 'en', locale: 'en-IN', name: 'English', nativeName: 'English', script: 'Latin', direction: 'ltr' },
  as: { code: 'as', locale: 'as-IN', name: 'Assamese', nativeName: 'অসমীয়া', script: 'Bengali-Assamese', direction: 'ltr' },
  bn: { code: 'bn', locale: 'bn-IN', name: 'Bengali', nativeName: 'বাংলা', script: 'Bengali', direction: 'ltr' },
  brx: { code: 'brx', locale: 'brx-IN', name: 'Bodo', nativeName: 'बड़ो', script: 'Devanagari', direction: 'ltr' },
  doi: { code: 'doi', locale: 'doi-IN', name: 'Dogri', nativeName: 'डोगरी', script: 'Devanagari', direction: 'ltr' },
  gu: { code: 'gu', locale: 'gu-IN', name: 'Gujarati', nativeName: 'ગુજરાતી', script: 'Gujarati', direction: 'ltr' },
  hi: { code: 'hi', locale: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', script: 'Devanagari', direction: 'ltr' },
  kn: { code: 'kn', locale: 'kn-IN', name: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'Kannada', direction: 'ltr' },
  ks: { code: 'ks', locale: 'ks-IN', name: 'Kashmiri', nativeName: 'کٲشُر', script: 'Perso-Arabic', direction: 'rtl' },
  kok: { code: 'kok', locale: 'kok-IN', name: 'Konkani', nativeName: 'कोंकणी', script: 'Devanagari', direction: 'ltr' },
  mai: { code: 'mai', locale: 'mai-IN', name: 'Maithili', nativeName: 'मैथिली', script: 'Devanagari', direction: 'ltr' },
  ml: { code: 'ml', locale: 'ml-IN', name: 'Malayalam', nativeName: 'മലയാളം', script: 'Malayalam', direction: 'ltr' },
  mni: { code: 'mni', locale: 'mni-IN', name: 'Manipuri/Meitei', nativeName: 'মৈতৈলোন', script: 'Meetei Mayek', direction: 'ltr' },
  mr: { code: 'mr', locale: 'mr-IN', name: 'Marathi', nativeName: 'मराठी', script: 'Devanagari', direction: 'ltr' },
  ne: { code: 'ne', locale: 'ne-IN', name: 'Nepali', nativeName: 'नेपाली', script: 'Devanagari', direction: 'ltr' },
  or: { code: 'or', locale: 'or-IN', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', script: 'Odia', direction: 'ltr' },
  pa: { code: 'pa', locale: 'pa-IN', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', script: 'Gurmukhi', direction: 'ltr' },
  sa: { code: 'sa', locale: 'sa-IN', name: 'Sanskrit', nativeName: 'संस्कृत', script: 'Devanagari', direction: 'ltr' },
  sat: { code: 'sat', locale: 'sat-IN', name: 'Santali', nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ', script: 'Ol Chiki', direction: 'ltr' },
  sd: { code: 'sd', locale: 'sd-IN', name: 'Sindhi', nativeName: 'سنڌي', script: 'Perso-Arabic', direction: 'rtl' },
  ta: { code: 'ta', locale: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்', script: 'Tamil', direction: 'ltr' },
  te: { code: 'te', locale: 'te-IN', name: 'Telugu', nativeName: 'తెలుగు', script: 'Telugu', direction: 'ltr' },
  ur: { code: 'ur', locale: 'ur-IN', name: 'Urdu', nativeName: 'اردو', script: 'Perso-Arabic', direction: 'rtl' }
});

const ALIASES = new Map([
  ['english', 'en'], ['en', 'en'], ['en-in', 'en'],
  ['assamese', 'as'], ['as', 'as'], ['as-in', 'as'], ['অসমীয়া', 'as'],
  ['bengali', 'bn'], ['bangla', 'bn'], ['bn', 'bn'], ['bn-in', 'bn'], ['বাংলা', 'bn'],
  ['bodo', 'brx'], ['brx', 'brx'], ['brx-in', 'brx'], ['बड़ो', 'brx'],
  ['dogri', 'doi'], ['doi', 'doi'], ['doi-in', 'doi'], ['डोगरी', 'doi'],
  ['gujarati', 'gu'], ['gu', 'gu'], ['gu-in', 'gu'], ['ગુજરાતી', 'gu'],
  ['hindi', 'hi'], ['hi', 'hi'], ['hi-in', 'hi'], ['हिन्दी', 'hi'], ['हिंदी', 'hi'],
  ['kannada', 'kn'], ['kn', 'kn'], ['kn-in', 'kn'], ['ಕನ್ನಡ', 'kn'],
  ['kashmiri', 'ks'], ['ks', 'ks'], ['ks-in', 'ks'], ['कश्मीरी', 'ks'], ['کٲشُر', 'ks'],
  ['konkani', 'kok'], ['kok', 'kok'], ['kok-in', 'kok'], ['कोंकणी', 'kok'],
  ['maithili', 'mai'], ['mai', 'mai'], ['mai-in', 'mai'], ['मैथिली', 'mai'],
  ['malayalam', 'ml'], ['ml', 'ml'], ['ml-in', 'ml'], ['മലയാളം', 'ml'],
  ['manipuri', 'mni'], ['meitei', 'mni'], ['mni', 'mni'], ['mni-in', 'mni'], ['মৈতৈলোন', 'mni'], ['ꯃꯤꯇꯩꯂꯣꯟ', 'mni'],
  ['marathi', 'mr'], ['mr', 'mr'], ['mr-in', 'mr'], ['मराठी', 'mr'],
  ['nepali', 'ne'], ['ne', 'ne'], ['ne-in', 'ne'], ['नेपाली', 'ne'],
  ['odia', 'or'], ['oriya', 'or'], ['or', 'or'], ['or-in', 'or'], ['ଓଡ଼ିଆ', 'or'],
  ['punjabi', 'pa'], ['pa', 'pa'], ['pa-in', 'pa'], ['ਪੰਜਾਬੀ', 'pa'],
  ['sanskrit', 'sa'], ['sa', 'sa'], ['sa-in', 'sa'], ['संस्कृत', 'sa'],
  ['santali', 'sat'], ['sat', 'sat'], ['sat-in', 'sat'], ['ᱥᱟᱱᱛᱟᱲᱤ', 'sat'],
  ['sindhi', 'sd'], ['sd', 'sd'], ['sd-in', 'sd'], ['سنڌي', 'sd'],
  ['tamil', 'ta'], ['ta', 'ta'], ['ta-in', 'ta'], ['தமிழ்', 'ta'],
  ['telugu', 'te'], ['te', 'te'], ['te-in', 'te'], ['తెలుగు', 'te'],
  ['urdu', 'ur'], ['ur', 'ur'], ['ur-in', 'ur'], ['اردو', 'ur']
]);

function normalizeLanguageInput(value) {
  return String(value || '').trim().toLowerCase().split(/[\s,/|]+/)[0];
}

function resolvePatientLanguage(patient) {
  if (patient && typeof patient === 'object' && LANGUAGE_DEFINITIONS[patient.code]) {
    const definition = LANGUAGE_DEFINITIONS[patient.code];
    return { ...definition, source: patient.source || 'patient_profile', fallbackUsed: Boolean(patient.fallbackUsed) };
  }
  const raw = typeof patient === 'string' ? patient : patient?.language;
  const key = normalizeLanguageInput(raw);
  const code = ALIASES.get(key);
  const definition = code ? LANGUAGE_DEFINITIONS[code] : LANGUAGE_DEFINITIONS.hi;
  return {
    ...definition,
    source: code ? 'patient_profile' : 'fallback',
    fallbackUsed: !code
  };
}

function getPatientGreeting(language) {
  const greetings = {
    en: 'Hello', as: 'নমস্কাৰ', bn: 'নমস্কার', brx: 'नमस्कार', doi: 'नमस्कार', gu: 'નમસ્તે', hi: 'नमस्ते',
    kn: 'ನಮಸ್ಕಾರ', ks: 'آداب', kok: 'नमस्कार', mai: 'प्रणाम', ml: 'നമസ്കാരം', mni: 'খুরুমজারি', mr: 'नमस्कार',
    ne: 'नमस्ते', or: 'ନମସ୍କାର', pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', sa: 'नमस्ते', sat: 'ᱡᱚᱦᱟᱨ', sd: 'سلام', ta: 'வணக்கம்',
    te: 'నమస్కారం', ur: 'السلام علیکم'
  };
  return greetings[resolvePatientLanguage(language).code] || greetings.hi;
}

module.exports = { LANGUAGE_DEFINITIONS, resolvePatientLanguage, getPatientGreeting };
