const { prisma } = require('../models/db');

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

module.exports = { requireBookedAppointment };
