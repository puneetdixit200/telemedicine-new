jest.mock('../apps/backend/models/db', () => ({
  prisma: {
    appointment: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    callSession: {
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    }
  }
}));

jest.mock('../apps/backend/services/presence.service', () => ({
  getAppointmentPresence: jest.fn(() => ({ doctorOnline: true, patientOnline: true }))
}));

jest.mock('../apps/backend/services/supabase-auth.service', () => ({
  getSupabaseAnonKey: jest.fn(() => 'anon-key'),
  getSupabaseUrl: jest.fn(() => 'https://example.supabase.co')
}));

const { prisma } = require('../apps/backend/models/db');
const { callsController } = require('../apps/backend/controllers/calls.controller');

function appointment() {
  return {
    id: 'appt-1',
    status: 'booked',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    familyMemberId: null,
    mode: 'video',
    doctor: { id: 'doctor-1', fullName: 'Doctor', doctorProfile: {} },
    patient: { id: 'patient-1', fullName: 'Patient', patientProfile: {} },
    familyMember: null
  };
}

function response() {
  return {
    statusCode: 200,
    rendered: null,
    redirectTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, locals) {
      this.rendered = { view, locals };
      return this;
    },
    redirect(url) {
      this.redirectTo = url;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

describe('call session timing hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.appointment.findUnique.mockResolvedValue(appointment());
    prisma.appointment.findMany.mockResolvedValue([]);
  });

  test('rejoining or refreshing does not overwrite the original startedAt', async () => {
    const originalStart = new Date('2026-08-12T10:00:00.000Z');
    prisma.callSession.upsert.mockResolvedValue({
      appointmentId: 'appt-1',
      status: 'in_progress',
      startedAt: originalStart,
      endedAt: null
    });

    const req = { params: { appointmentId: 'appt-1' }, user: { id: 'patient-1', role: 'patient' } };
    const res = response();
    const next = jest.fn();

    await callsController.viewCall(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prisma.callSession.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { appointmentId: 'appt-1' },
      update: { status: 'in_progress', endedAt: null }
    }));
    expect(prisma.callSession.upsert.mock.calls[0][0].update).not.toHaveProperty('startedAt');
    expect(prisma.callSession.update).not.toHaveBeenCalled();
  });

  test('legacy call rows missing startedAt are backfilled once', async () => {
    prisma.callSession.upsert.mockResolvedValue({
      appointmentId: 'appt-1',
      status: 'in_progress',
      startedAt: null,
      endedAt: null
    });
    prisma.callSession.update.mockResolvedValue({ startedAt: new Date() });

    await callsController.viewCall(
      { params: { appointmentId: 'appt-1' }, user: { id: 'doctor-1', role: 'doctor' } },
      response(),
      jest.fn()
    );

    expect(prisma.callSession.update).toHaveBeenCalledTimes(1);
    expect(prisma.callSession.update.mock.calls[0][0].data.startedAt).toBeInstanceOf(Date);
  });

  test('ending a call updates only sessions that are not already ended', async () => {
    prisma.callSession.updateMany.mockResolvedValue({ count: 1 });
    const res = response();

    await callsController.endCall(
      { params: { appointmentId: 'appt-1' }, user: { id: 'patient-1', role: 'patient' } },
      res,
      jest.fn()
    );

    expect(prisma.callSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { appointmentId: 'appt-1', status: { not: 'ended' } }
    }));
    expect(res.redirectTo).toBe('/appointments/appt-1');
  });
});
