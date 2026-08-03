function getPatientGreeting(language) {
  const normalized = String(language || '').trim().toLowerCase();

  if (normalized.startsWith('english')) return 'Hello';
  if (normalized.startsWith('hindi') || normalized.startsWith('हिंदी')) return 'Namaste';

  return 'Namaste';
}

module.exports = { getPatientGreeting };
