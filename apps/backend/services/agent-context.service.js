const { prisma } = require('../models/db');

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    language: user.language,
    doctorProfile: user.doctorProfile || undefined
  };
}

async function loadAppointment(appointmentId) {
  return prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: true,
      doctor: { include: { doctorProfile: true } },
      prescription: true
    }
  });
}

async function loadAvailableSlots(doctorId) {
  return prisma.slot.findMany({
    where: {
      doctorId,
      status: 'available',
      startAt: { gt: new Date() }
    },
    orderBy: { startAt: 'asc' },
    take: 3,
    select: {
      id: true,
      startAt: true
    }
  });
}

async function loadNoShowContext(appointmentId) {
  const appointment = await loadAppointment(appointmentId);
  if (!appointment) return null;

  const [availableSlots, priorNoShowCount] = await Promise.all([
    loadAvailableSlots(appointment.doctorId),
    prisma.appointment.count({
      where: {
        patientId: appointment.patientId,
        id: { not: appointment.id },
        status: 'no_show'
      }
    })
  ]);

  return {
    appointment: {
      id: appointment.id,
      status: appointment.status,
      startAt: appointment.startAt,
      mode: appointment.mode,
      problemDescription: appointment.problemDescription,
      updatedAt: appointment.updatedAt,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId
    },
    patient: safeUser(appointment.patient),
    doctor: safeUser(appointment.doctor),
    availableSlots,
    priorNoShowCount,
    quickRebookPath: `/book?doctorId=${encodeURIComponent(appointment.doctorId)}&fromAppointmentId=${encodeURIComponent(
      appointment.id
    )}&rebook=1`
  };
}

async function loadPostVisitContext(appointmentId) {
  const appointment = await loadAppointment(appointmentId);
  if (!appointment) return null;
  const [availableSlots, existingReminderJobs] = await Promise.all([
    loadAvailableSlots(appointment.doctorId),
    prisma.reminderJob.findMany({
      where: { appointmentId: appointment.id, templateKey: 'prescription_refill_3d' },
      orderBy: { createdAt: 'desc' },
      take: 5
    })
  ]);

  return {
    appointment: {
      id: appointment.id,
      status: appointment.status,
      startAt: appointment.startAt,
      problemDescription: appointment.problemDescription,
      updatedAt: appointment.updatedAt,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId
    },
    patient: safeUser(appointment.patient),
    doctor: safeUser(appointment.doctor),
    prescription: appointment.prescription
      ? {
          id: appointment.prescription.id,
          diagnosis: appointment.prescription.diagnosis,
          items: appointment.prescription.items,
          instructions: appointment.prescription.instructions,
          followUpAt: appointment.prescription.followUpAt,
          notes: appointment.prescription.notes,
          updatedAt: appointment.prescription.updatedAt
        }
      : null,
    availableSlots,
    existingReminderJobs
  };
}

module.exports = {
  loadNoShowContext,
  loadPostVisitContext
};
