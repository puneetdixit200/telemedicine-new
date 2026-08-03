function getPatientGreeting(language) {
  const normalized = String(language || '').trim().toLowerCase();
  const key = normalized.split(/[\s,/|]+/)[0];
  const greetings = {
    english: 'Hello',
    en: 'Hello',
    assamese: 'Nomoskar',
    as: 'Nomoskar',
    bengali: 'Nomoshkar',
    bn: 'Nomoshkar',
    gujarati: 'Namaste',
    gu: 'Namaste',
    hindi: 'Namaste',
    hi: 'Namaste',
    kannada: 'Namaskara',
    kn: 'Namaskara',
    malayalam: 'Namaskaram',
    ml: 'Namaskaram',
    marathi: 'Namaskar',
    mr: 'Namaskar',
    nepali: 'Namaste',
    ne: 'Namaste',
    odia: 'Namaskar',
    or: 'Namaskar',
    oriya: 'Namaskar',
    punjabi: 'Sat Sri Akaal',
    pa: 'Sat Sri Akaal',
    tamil: 'Vanakkam',
    ta: 'Vanakkam',
    telugu: 'Namaskaram',
    te: 'Namaskaram',
    urdu: 'Assalamualaikum',
    ur: 'Assalamualaikum'
  };

  return greetings[key] || 'Namaste';
}

module.exports = { getPatientGreeting };
