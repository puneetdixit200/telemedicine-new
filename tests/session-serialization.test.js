const { serializeSessionUser } = require('../apps/backend/routes');

describe('session serialization', () => {
  it('does not expose password hashes in API session payloads', () => {
    const user = serializeSessionUser({
      id: 'user-1',
      email: 'patient@example.com',
      fullName: 'Patient Example',
      passwordHash: 'secret-hash',
      supabaseAuthUserId: 'auth-user-1',
      role: 'patient',
      patientProfile: { userId: 'user-1' },
      doctorProfile: null
    });

    expect(user).toMatchObject({
      id: 'user-1',
      email: 'patient@example.com',
      role: 'patient'
    });
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('supabaseAuthUserId');
  });
});
