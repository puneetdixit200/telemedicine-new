const { prisma } = require('../models/db');
const { getAppointmentPresence } = require('../services/presence.service');
const { getSupabaseAnonKey, getSupabaseUrl } = require('../services/supabase-auth.service');

async function ensureAppointmentAccess(appointmentId, user) {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      doctor: { include: { doctorProfile: true } },
      patient: { include: { patientProfile: true } },
      familyMember: true
    }
  });
  if (!appt) return null;
  if (user.role === 'admin') return appt;
  if (user.id !== appt.patientId && user.id !== appt.doctorId) return null;
  return appt;
}

async function loadPatientHistory(appointment) {
  const where = appointment.familyMemberId
    ? { patientId: appointment.patientId, familyMemberId: appointment.familyMemberId, status: 'completed' }
    : { patientId: appointment.patientId, familyMemberId: null, status: 'completed' };

  const historyAppointments = await prisma.appointment.findMany({
    where: {
      ...where,
      id: { not: appointment.id }
    },
    include: {
      doctor: { select: { fullName: true } },
      prescription: true
    },
    orderBy: { startAt: 'desc' },
    take: 15
  });

  return {
    currentPatientProfile: appointment.familyMember
      ? {
          name: appointment.familyMember.fullName,
          chronicConditions: appointment.familyMember.chronicConditions,
          basicHealthInfo: appointment.familyMember.basicHealthInfo,
          relationToPatient: appointment.familyMember.relationToPatient
        }
      : {
          name: appointment.patient.fullName,
          chronicConditions: appointment.patient.patientProfile?.chronicConditions || null,
          basicHealthInfo: appointment.patient.patientProfile?.basicHealthInfo || null,
          relationToPatient: null
        },
    historyAppointments
  };
}

const callsController = {
  viewCall: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Appointment not found' });
      if (appt.status !== 'booked') {
        return res.status(403).render('dashboard', {
          user: req.user,
          message: 'This appointment is closed. Call is not allowed.'
        });
      }

      const presence = getAppointmentPresence(appt);

      await prisma.callSession.upsert({
        where: { appointmentId },
        update: { status: 'in_progress', startedAt: new Date(), endedAt: null },
        create: { appointmentId, status: 'in_progress', startedAt: new Date() }
      });

      const history = await loadPatientHistory(appt);

      const supabaseUrl = getSupabaseUrl();
      const supabaseAnonKey = getSupabaseAnonKey();
      if (!supabaseUrl || !supabaseAnonKey) {
        return res.status(500).render('dashboard', {
          user: req.user,
          message: 'Realtime calling is not configured.'
        });
      }

      const callConfigJson = JSON.stringify({
        appointmentId: appt.id,
        supabaseUrl,
        supabaseAnonKey,
        realtimeTopic: `call:${appt.id}`,
        userRole: req.user.role,
        iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
        defaultMode: appt.mode
      });
      const callConfigEncoded = encodeURIComponent(callConfigJson);

      return res.render('call', {
        user: req.user,
        appointment: appt,
        presence,
        history,
        iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
        callConfigJson,
        callConfigEncoded
      });
    } catch (e) {
      return next(e);
    }
  },

  endCall: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).json({ error: 'Not found' });

      await prisma.callSession.updateMany({
        where: { appointmentId },
        data: { status: 'ended', endedAt: new Date() }
      });

      return res.redirect(`/appointments/${appointmentId}`);
    } catch (e) {
      return next(e);
    }
  }
};

module.exports = { callsController };
