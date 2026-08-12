jest.mock('../apps/backend/models/db', () => ({
  prisma: {
    appointment: { findUnique: jest.fn() },
    slot: { findUnique: jest.fn() }
  }
}));

const { prisma } = require('../apps/backend/models/db');
const {
  requireFutureBookableSlot,
  requireBookedAppointment
} = require('../apps/backend/middleware/appointment-state');

function mockResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

describe('appointment state middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('allows only booked appointment mutation', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', status: 'booked' });
    const req = { params: { appointmentId: 'appt-1' } };
    const res = mockResponse();
    const next = jest.fn();

    await requireBookedAppointment(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.appointmentState).toEqual({ id: 'appt-1', status: 'booked' });
  });

  test.each(['completed', 'cancelled', 'no_show'])('blocks %s appointment mutation', async (status) => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', status });
    const res = mockResponse();
    const next = jest.fn();

    await requireBookedAppointment({ params: { appointmentId: 'appt-1' } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
  });

  test('blocks unavailable, past and inactive-doctor slots', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);

    prisma.slot.findUnique.mockResolvedValueOnce({ id: 'slot-1', status: 'booked', startAt: future, doctor: { isActive: true } });
    let res = mockResponse();
    await requireFutureBookableSlot({ body: { slotId: 'slot-1' } }, res, jest.fn());
    expect(res.statusCode).toBe(409);

    prisma.slot.findUnique.mockResolvedValueOnce({ id: 'slot-2', status: 'available', startAt: new Date(Date.now() - 1000), doctor: { isActive: true } });
    res = mockResponse();
    await requireFutureBookableSlot({ body: { slotId: 'slot-2' } }, res, jest.fn());
    expect(res.statusCode).toBe(409);

    prisma.slot.findUnique.mockResolvedValueOnce({ id: 'slot-3', status: 'available', startAt: future, doctor: { isActive: false } });
    res = mockResponse();
    await requireFutureBookableSlot({ body: { slotId: 'slot-3' } }, res, jest.fn());
    expect(res.statusCode).toBe(409);
  });

  test('allows an available future slot for an active doctor', async () => {
    const slot = {
      id: 'slot-ok',
      status: 'available',
      startAt: new Date(Date.now() + 60 * 60 * 1000),
      doctor: { isActive: true }
    };
    prisma.slot.findUnique.mockResolvedValue(slot);
    const req = { body: { slotId: slot.id } };
    const res = mockResponse();
    const next = jest.fn();

    await requireFutureBookableSlot(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.bookingSlot).toEqual(slot);
  });
});
