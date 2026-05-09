const { sanitizeApiPayload } = require('../apps/backend/middleware/api-mode');

describe('api mode payload sanitation', () => {
  it('removes password hashes from nested render payloads', () => {
    const payload = sanitizeApiPayload({
      user: { id: 'u1', passwordHash: 'secret', supabaseAuthUserId: 'auth-user-1' },
      appointment: {
        patient: { id: 'u2', passwordHash: 'patient-secret' },
        doctor: { id: 'u3', passwordHash: 'doctor-secret' }
      }
    });

    expect(JSON.stringify(payload)).not.toContain('passwordHash');
    expect(JSON.stringify(payload)).not.toContain('supabaseAuthUserId');
    expect(payload).toMatchObject({
      user: { id: 'u1' },
      appointment: {
        patient: { id: 'u2' },
        doctor: { id: 'u3' }
      }
    });
  });
});
