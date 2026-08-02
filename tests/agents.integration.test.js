const request = require('supertest');
const { createApp } = require('../app');

describe('agent API routes', () => {
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
    app = createApp();
  });

  it('protects plan generation under both API prefixes', async () => {
    const appointmentId = '11111111-1111-4111-8111-111111111111';

    const unversioned = await request(app).post(`/api/agents/no-show/${appointmentId}/plan`).send({});
    const versioned = await request(app).post(`/api/v1/agents/post-visit/${appointmentId}/plan`).send({});

    expect(unversioned.status).toBe(401);
    expect(versioned.status).toBe(401);
    expect(unversioned.body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(versioned.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('protects the admin operations API under both API prefixes', async () => {
    const unversioned = await request(app).get('/api/admin/agents/overview');
    const versioned = await request(app).get('/api/v1/admin/agents/overview');
    expect(unversioned.status).toBe(401);
    expect(versioned.status).toBe(401);
    expect(unversioned.body.code).toBe('UNAUTHORIZED');
    expect(versioned.body.code).toBe('UNAUTHORIZED');
  });
});
