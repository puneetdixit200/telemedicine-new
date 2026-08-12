const { prisma } = require('../models/db');

async function requireFutureBookableSlot(req, res, next) {
  try {
    const slotId = String(req.body?.slotId || '').trim();
    if (!slotId) {
      return res.status(400).json({ error: 'Slot id is required.' });
    }

    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        status: true,
        startAt: true,
        doctor: { select: { isActive: true } }
      }
    });

    if (!slot) {
      return res.status(404).json({ error: 'Slot not found.' });
    }

    if (!slot.doctor?.isActive) {
      return res.status(409).json({ error: 'This doctor is not currently available for booking.' });
    }

    if (slot.status !== 'available') {
      return res.status(409).json({ error: 'Slot is no longer available.' });
    }

    if (new Date(slot.startAt).getTime() <= Date.now()) {
      return res.status(409).json({ error: 'Past appointment slots cannot be booked.' });
    }

    req.bookingSlot = slot;
    return next();
  } catch (error) {
    return next(error);
  }
}

async function requireBookedAppointment(req, res, next) {
  try {
    const appointmentId = String(req.params?.appointmentId || '').trim();
    if (!appointmentId) {
      return res.status(400).json({ error: 'Appointment id is required.' });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, status: true }
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (appointment.status !== 'booked') {
      return res.status(409).json({
        error: 'Only booked appointments can be changed by this action.',
        status: appointment.status
      });
    }

    req.appointmentState = appointment;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireFutureBookableSlot, requireBookedAppointment };
