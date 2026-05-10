const { prisma } = require('../models/db');
const { bookSchema, preconsultSchema, reviewSchema, noShowFollowUpSchema } = require('../models/schemas/appointments.schemas');
const { getAppointmentPresence } = require('../services/presence.service');
const { scheduleRemindersForAppointment, cancelScheduledRemindersForAppointment } = require('../services/reminder.service');

function isMissingDoctorReviewTable(error) {
  return Boolean(
    error &&
      error.code === 'P2021' &&
      String(error.meta?.table || '')
        .toLowerCase()
        .includes('doctorreview')
  );
}

function getIstDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function normalizePhone(value) {
  return String(value || '')
    .replace(/[^0-9]/g, '')
    .trim();
}

function isMissingExternalConsultTable(error) {
  return Boolean(
    error &&
      error.code === 'P2021' &&
      /externalconsultthread|externalconsultmessage/i.test(String(error.meta?.table || ''))
  );
}

function buildNoShowFollowUpMessage(appointment, reason = '') {
  const patientName = String(appointment.patient?.fullName || 'Patient').trim();
  const doctorName = String(appointment.doctor?.fullName || 'Doctor').trim();
  const quickRebookPath = `/book?doctorId=${encodeURIComponent(appointment.doctorId)}&fromAppointmentId=${encodeURIComponent(
    appointment.id
  )}&rebook=1`;
  const reasonPart = reason ? ` Reason noted: ${reason}.` : '';

  return `Namaste ${patientName}. We could not connect for your consultation with Dr. ${doctorName}.${reasonPart} Reply here if you need support, or quickly rebook here: ${quickRebookPath}`;
}

function buildHelperPhoneWhere(phone) {
  const raw = String(phone || '').trim();
  const normalized = normalizePhone(phone);
  const tail10 = normalized.length >= 10 ? normalized.slice(-10) : '';

  const where = [];
  if (raw) where.push({ helperPhone: raw });
  if (normalized) where.push({ helperPhone: normalized });
  if (tail10) where.push({ helperPhone: { endsWith: tail10 } });
  return where;
}

async function getHelperAppointmentScope(user) {
  const phoneWhere = buildHelperPhoneWhere(user.phone);
  if (!phoneWhere.length) {
    return { patientIds: [], appointmentIds: [] };
  }

  const helperLinks = await prisma.careSupportLink.findMany({
    where: {
      isActive: true,
      OR: phoneWhere
    },
    select: { id: true }
  });

  if (!helperLinks.length) {
    return { patientIds: [], appointmentIds: [] };
  }

  const helperIds = helperLinks.map((row) => row.id);
  const consentRows = await prisma.consentAudit.findMany({
    where: {
      helperId: { in: helperIds },
      isActive: true,
      scope: { in: ['all', 'appointment'] }
    },
    select: {
      patientId: true,
      appointmentId: true,
      scope: true
    }
  });

  const patientIds = new Set();
  const appointmentIds = new Set();

  consentRows.forEach((row) => {
    if (row.scope === 'all' || (row.scope === 'appointment' && !row.appointmentId)) {
      if (row.patientId) patientIds.add(row.patientId);
    }
    if (row.scope === 'appointment' && row.appointmentId) {
      appointmentIds.add(row.appointmentId);
    }
  });

  return {
    patientIds: [...patientIds],
    appointmentIds: [...appointmentIds]
  };
}

async function ensureAppointmentAccess(appointmentId, user) {
  let appt;
  try {
    appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctor: { include: { doctorProfile: true } },
        patient: { include: { patientProfile: true } },
        familyMember: true,
        documents: true,
        prescription: true,
        review: true
      }
    });
  } catch (error) {
    if (!isMissingDoctorReviewTable(error)) throw error;
    appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctor: { include: { doctorProfile: true } },
        patient: { include: { patientProfile: true } },
        familyMember: true,
        documents: true,
        prescription: true
      }
    });
    if (appt) {
      appt.review = null;
    }
  }

  if (!appt) return null;
  if (user.role === 'admin') return appt;
  if (user.role === 'help_worker') {
    const scope = await getHelperAppointmentScope(user);
    const canViewByPatient = scope.patientIds.includes(appt.patientId);
    const canViewByAppointment = scope.appointmentIds.includes(appt.id);
    if (!canViewByPatient && !canViewByAppointment) return null;
    return appt;
  }
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
    take: 20
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

async function loadWorkspaceDocuments(appointment) {
  const where = {
    ownerId: appointment.patientId,
    appointmentId: null,
    familyMemberId: appointment.familyMemberId || null
  };

  return prisma.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100
  });
}

function computeTriage(problemDescription) {
  const text = String(problemDescription || '').toLowerCase();
  if (!text) return { level: 'unknown', score: 0, label: 'Not assessed' };

  const criticalTerms = ['chest pain', 'breathing', 'unconscious', 'stroke', 'seizure', 'bleeding heavily'];
  const urgentTerms = ['high fever', 'severe pain', 'vomiting', 'dehydration', 'infection', 'wheezing'];
  const moderateTerms = ['headache', 'rash', 'fatigue', 'cough', 'sore throat', 'stomach pain'];

  let score = 0;
  criticalTerms.forEach((t) => {
    if (text.includes(t)) score += 3;
  });
  urgentTerms.forEach((t) => {
    if (text.includes(t)) score += 2;
  });
  moderateTerms.forEach((t) => {
    if (text.includes(t)) score += 1;
  });

  if (score >= 6) return { level: 'critical', score, label: 'Critical' };
  if (score >= 3) return { level: 'high', score, label: 'High' };
  if (score >= 1) return { level: 'moderate', score, label: 'Moderate' };
  return { level: 'low', score, label: 'Low' };
}

const TRIAGE_LABELS = {
  unknown: 'Not assessed',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical'
};

function getAppointmentTriage(appointment) {
  const level = String(appointment?.triageLevel || '').toLowerCase();
  const score = Number(appointment?.triageScore);
  if (TRIAGE_LABELS[level] && Number.isFinite(score)) {
    return {
      level,
      score,
      label: TRIAGE_LABELS[level]
    };
  }
  return computeTriage(appointment?.problemDescription);
}

function buildReminderInfo(startAt) {
  const now = Date.now();
  const startMs = new Date(startAt).getTime();
  const diffMins = Math.round((startMs - now) / 60000);

  if (Number.isNaN(diffMins)) {
    return { dueSoon: false, label: 'Schedule unavailable', minutesUntil: null };
  }
  if (diffMins <= 0) {
    return { dueSoon: true, label: 'Session time reached', minutesUntil: diffMins };
  }
  if (diffMins <= 30) {
    return { dueSoon: true, label: 'Reminder: starts in under 30 minutes', minutesUntil: diffMins };
  }
  if (diffMins <= 24 * 60) {
    return { dueSoon: true, label: 'Reminder: starts within 24 hours', minutesUntil: diffMins };
  }
  return { dueSoon: false, label: 'No reminder yet', minutesUntil: diffMins };
}

function deriveRegion(address) {
  const raw = String(address || '').trim();
  if (!raw) return 'Unknown';
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return 'Unknown';
  return parts[parts.length - 1].slice(0, 40) || 'Unknown';
}

async function loadAdminOperationalMetrics() {
  const startedAt = Date.now();
  let databaseStatus = 'up';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (_err) {
    databaseStatus = 'down';
  }

  let reminderQueueDepth = null;
  let failedReminders24h = null;

  try {
    reminderQueueDepth = await prisma.reminderJob.count({ where: { status: 'scheduled' } });
    failedReminders24h = await prisma.reminderJob.count({
      where: {
        status: 'failed',
        failedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }
    });
  } catch (_err) {
    reminderQueueDepth = null;
    failedReminders24h = null;
  }

  return {
    readiness: databaseStatus === 'up' ? 'ready' : 'degraded',
    databaseStatus,
    dbLatencyMs: Math.max(0, Date.now() - startedAt),
    reminderQueueDepth,
    failedReminders24h
  };
}

async function renderAppointmentPage(res, reqUser, appointment, opts = {}) {
  const history = await loadPatientHistory(appointment);
  const workspaceDocuments = await loadWorkspaceDocuments(appointment);
  const familyMembers =
    opts.familyMembers ||
    (reqUser.role === 'patient' && reqUser.id === appointment.patientId
      ? await prisma.familyMember.findMany({
          where: { ownerPatientId: reqUser.id },
          orderBy: { fullName: 'asc' }
        })
      : []);

  return res.render('appointment', {
    user: reqUser,
    appointment,
    presence: getAppointmentPresence(appointment),
    history,
    workspaceDocuments,
    familyMembers,
    triage: getAppointmentTriage(appointment),
    reminder: buildReminderInfo(appointment.startAt),
    rebookShortcut: `/book?doctorId=${encodeURIComponent(appointment.doctorId)}&fromAppointmentId=${encodeURIComponent(
      appointment.id
    )}&rebook=1`,
    followUp: opts.followUp || null,
    error: opts.error || null,
    message: opts.message || null
  });
}

const appointmentsController = {
  listMyAppointments: async (req, res, next) => {
    try {
      let where;

      if (req.user.role === 'doctor') {
        where = { doctorId: req.user.id };
      } else if (req.user.role === 'patient') {
        where = { patientId: req.user.id };
      } else if (req.user.role === 'help_worker') {
        const scope = await getHelperAppointmentScope(req.user);
        const clauses = [];
        if (scope.patientIds.length) clauses.push({ patientId: { in: scope.patientIds } });
        if (scope.appointmentIds.length) clauses.push({ id: { in: scope.appointmentIds } });
        where = clauses.length ? { OR: clauses } : { id: '__no_access__' };
      } else if (req.user.role === 'admin') {
        where = {};
      } else {
        return res.status(403).json({ error: 'Forbidden' });
      }

      let appointments;
      try {
        appointments = await prisma.appointment.findMany({
          where,
          include: {
            doctor: { select: { id: true, fullName: true } },
            patient: { select: { id: true, fullName: true } },
            familyMember: { select: { id: true, fullName: true } },
            prescription: { select: { id: true } },
            review: { select: { id: true, rating: true } }
          },
          orderBy: { startAt: 'desc' },
          take: 300
        });
      } catch (error) {
        if (!isMissingDoctorReviewTable(error)) throw error;
        const fallback = await prisma.appointment.findMany({
          where,
          include: {
            doctor: { select: { id: true, fullName: true } },
            patient: { select: { id: true, fullName: true } },
            familyMember: { select: { id: true, fullName: true } },
            prescription: { select: { id: true } }
          },
          orderBy: { startAt: 'desc' },
          take: 300
        });
        appointments = fallback.map((appointment) => ({ ...appointment, review: null }));
      }

      const now = new Date();
      const upcomingAppointments = appointments
        .filter((a) => a.status === 'booked' && new Date(a.startAt) >= now)
        .map((a) => ({
          ...a,
          triage: getAppointmentTriage(a),
          reminder: buildReminderInfo(a.startAt)
        }))
        .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

      const doneAppointments = appointments
        .filter((a) => !(a.status === 'booked' && new Date(a.startAt) >= now))
        .map((a) => ({
          ...a,
          triage: getAppointmentTriage(a),
          reminder: buildReminderInfo(a.startAt)
        }))
        .sort((a, b) => new Date(b.startAt) - new Date(a.startAt));

      return res.render('appointments', {
        user: req.user,
        upcomingAppointments,
        doneAppointments
      });
    } catch (e) {
      return next(e);
    }
  },

  viewAppointment: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Appointment not found' });

      return renderAppointmentPage(res, req.user, appt);
    } catch (e) {
      return next(e);
    }
  },

  getPresence: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).json({ error: 'Appointment not found' });

      const presence = getAppointmentPresence(appt);
      return res.json({ ok: true, ...presence });
    } catch (e) {
      return next(e);
    }
  },

  book: async (req, res, next) => {
    try {
      const parsed = bookSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).render('dashboard', { user: req.user, message: 'Invalid booking request' });

      const { slotId, mode } = parsed.data;
      const familyMemberId = parsed.data.familyMemberId || null;
      const problemDescription = parsed.data.problemDescription || null;
      const medicationsText = parsed.data.medicationsText || null;
      const triage = computeTriage(problemDescription);

      if (familyMemberId) {
        const member = await prisma.familyMember.findFirst({
          where: { id: familyMemberId, ownerPatientId: req.user.id }
        });
        if (!member) {
          return res.status(403).render('dashboard', { user: req.user, message: 'Invalid family member selection.' });
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.slot.updateMany({
          where: { id: slotId, status: 'available' },
          data: { status: 'booked' }
        });
        if (updated.count !== 1) {
          const err = new Error('Slot is not available.');
          err.status = 409;
          throw err;
        }

        const slot = await tx.slot.findUnique({ where: { id: slotId } });
        if (!slot) {
          const err = new Error('Slot not found.');
          err.status = 404;
          throw err;
        }

        const appt = await tx.appointment.create({
          data: {
            patientId: req.user.id,
            doctorId: slot.doctorId,
            startAt: slot.startAt,
            mode,
            status: 'booked',
            slotId: slot.id,
            familyMemberId,
            problemDescription,
            medicationsText,
            triageLevel: triage.level,
            triageScore: triage.score
          }
        });

        await tx.slot.update({
          where: { id: slot.id },
          data: { appointment: { connect: { id: appt.id } } }
        });

        return appt;
      });

      await scheduleRemindersForAppointment(result.id).catch(() => {});

      return res.redirect(`/appointments/${result.id}`);
    } catch (e) {
      if (req.accepts('html')) {
        return res.status(e.status || 500).render('dashboard', { user: req.user, message: e.message || 'Booking failed' });
      }
      return next(e);
    }
  },

  updatePreconsult: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const parsed = preconsultSchema.safeParse(req.body);
      if (!parsed.success) {
        const appt = await ensureAppointmentAccess(appointmentId, req.user);
        if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Appointment not found' });
        res.status(400);
        return renderAppointmentPage(res, req.user, appt, {
          error: 'Invalid input'
        });
      }

      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Appointment not found' });
      if (appt.status !== 'booked') {
        return res.status(409).render('dashboard', { user: req.user, message: 'Appointment already closed.' });
      }
      if (req.user.role !== 'patient' || req.user.id !== appt.patientId) {
        res.status(403);
        return renderAppointmentPage(res, req.user, appt, {
          error: 'Only patient can update this.'
        });
      }

      let updated;
      const triage = computeTriage(parsed.data.problemDescription);
      try {
        updated = await prisma.appointment.update({
          where: { id: appointmentId },
          data: {
            problemDescription: parsed.data.problemDescription || null,
            medicationsText: parsed.data.medicationsText || null,
            triageLevel: triage.level,
            triageScore: triage.score
          },
          include: {
            doctor: { include: { doctorProfile: true } },
            patient: { include: { patientProfile: true } },
            documents: true,
            prescription: true,
            review: true
          }
        });
      } catch (error) {
        if (!isMissingDoctorReviewTable(error)) throw error;
        updated = await prisma.appointment.update({
          where: { id: appointmentId },
          data: {
            problemDescription: parsed.data.problemDescription || null,
            medicationsText: parsed.data.medicationsText || null,
            triageLevel: triage.level,
            triageScore: triage.score
          },
          include: {
            doctor: { include: { doctorProfile: true } },
            patient: { include: { patientProfile: true } },
            documents: true,
            prescription: true
          }
        });
        updated.review = null;
      }

      const familyMembers = await prisma.familyMember.findMany({
        where: { ownerPatientId: req.user.id },
        orderBy: { fullName: 'asc' }
      });
      return renderAppointmentPage(res, req.user, updated, { familyMembers, message: 'Saved.' });
    } catch (e) {
      return next(e);
    }
  },

  submitReview: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const parsed = reviewSchema.safeParse(req.body);
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Appointment not found' });

      if (!parsed.success) {
        res.status(400);
        return renderAppointmentPage(res, req.user, appt, {
          error: 'Please provide a valid rating between 1 and 5.'
        });
      }

      if (req.user.id !== appt.patientId) {
        res.status(403);
        return renderAppointmentPage(res, req.user, appt, {
          error: 'Only the patient can submit a doctor review.'
        });
      }

      if (appt.status !== 'completed') {
        res.status(409);
        return renderAppointmentPage(res, req.user, appt, {
          error: 'You can review a doctor only after the appointment is completed.'
        });
      }

      const normalizedComment = parsed.data.comment ? parsed.data.comment.trim() : null;

      try {
        await prisma.doctorReview.upsert({
          where: { appointmentId },
          update: {
            rating: parsed.data.rating,
            comment: normalizedComment || null
          },
          create: {
            appointmentId,
            doctorId: appt.doctorId,
            patientId: appt.patientId,
            rating: parsed.data.rating,
            comment: normalizedComment || null
          }
        });
      } catch (error) {
        if (!isMissingDoctorReviewTable(error)) throw error;
        return renderAppointmentPage(res, req.user, appt, {
          message: 'Review feature is temporarily unavailable. Please run the latest database migration.'
        });
      }

      const refreshed = await ensureAppointmentAccess(appointmentId, req.user);
      return renderAppointmentPage(res, req.user, refreshed, {
        message: 'Thanks. Your review has been saved.'
      });
    } catch (e) {
      return next(e);
    }
  },

  markNoShowAndFollowUp: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Appointment not found' });

      const isDoctorOwner = req.user.role === 'doctor' && req.user.id === appt.doctorId;
      const isAdmin = req.user.role === 'admin';
      if (!isDoctorOwner && !isAdmin) {
        return res.status(403).render('dashboard', { user: req.user, message: 'Only assigned doctor or admin can mark no-show.' });
      }

      if (appt.status !== 'booked' && appt.status !== 'no_show') {
        return res.status(409).render('dashboard', {
          user: req.user,
          message: 'Only booked appointments can be transitioned to no-show.'
        });
      }

      const parsed = noShowFollowUpSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return renderAppointmentPage(res, req.user, appt, {
          error: 'Invalid follow-up note. Please shorten your message and retry.'
        });
      }

      if (appt.status !== 'no_show') {
        await prisma.appointment.update({
          where: { id: appointmentId },
          data: { status: 'no_show' }
        });
      }

      await cancelScheduledRemindersForAppointment(appointmentId).catch(() => {});

      const followUp = {
        threadId: null,
        messageId: null,
        warning: null
      };

      const reason = String(parsed.data.reason || '').trim();
      const customMessage = String(parsed.data.message || '').trim();

      if (!String(appt.patient?.phone || '').trim()) {
        followUp.warning = 'Patient phone is missing, so async follow-up draft was not created.';
      } else {
        try {
          const drafted = await prisma.$transaction(async (tx) => {
            const thread = await tx.externalConsultThread.upsert({
              where: { appointmentId: appt.id },
              update: {
                channel: 'whatsapp',
                contactPhone: appt.patient.phone
              },
              create: {
                appointmentId: appt.id,
                patientId: appt.patientId,
                channel: 'whatsapp',
                contactPhone: appt.patient.phone
              }
            });

            const quickRebookPath = `/book?doctorId=${encodeURIComponent(appt.doctorId)}&fromAppointmentId=${encodeURIComponent(
              appt.id
            )}&rebook=1`;
            const body = customMessage || buildNoShowFollowUpMessage(appt, reason);

            const message = await tx.externalConsultMessage.create({
              data: {
                threadId: thread.id,
                direction: 'outbound',
                body,
                syncedById: req.user.id,
                deliveryStatus: 'queued',
                metadata: {
                  type: 'no_show_follow_up',
                  reason: reason || null,
                  quickRebookPath
                }
              }
            });

            await tx.externalConsultThread.update({
              where: { id: thread.id },
              data: { lastMessageAt: new Date() }
            });

            return { threadId: thread.id, messageId: message.id };
          });

          followUp.threadId = drafted.threadId;
          followUp.messageId = drafted.messageId;
        } catch (error) {
          if (!isMissingExternalConsultTable(error)) throw error;
          followUp.warning =
            'No-show was recorded, but async follow-up tables are unavailable. Apply latest migration to enable message drafts.';
        }
      }

      const refreshed = await ensureAppointmentAccess(appointmentId, req.user);
      const successMessage = followUp.warning
        ? `Appointment marked as no-show. ${followUp.warning}`
        : followUp.messageId
          ? 'Appointment marked as no-show and follow-up draft saved.'
          : 'Appointment marked as no-show.';

      return renderAppointmentPage(res, req.user, refreshed || appt, {
        followUp,
        message: successMessage
      });
    } catch (e) {
      return next(e);
    }
  },

  viewImpactDashboard: async (req, res, next) => {
    try {
      let where;
      if (req.user.role === 'doctor') {
        where = { doctorId: req.user.id };
      } else if (req.user.role === 'patient') {
        where = { patientId: req.user.id };
      } else if (req.user.role === 'help_worker') {
        const scope = await getHelperAppointmentScope(req.user);
        const clauses = [];
        if (scope.patientIds.length) clauses.push({ patientId: { in: scope.patientIds } });
        if (scope.appointmentIds.length) clauses.push({ id: { in: scope.appointmentIds } });
        where = clauses.length ? { OR: clauses } : { id: '__no_access__' };
      } else if (req.user.role === 'admin') {
        where = {};
      } else {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const appointments = await prisma.appointment.findMany({
        where,
        include: {
          doctor: { select: { id: true, fullName: true } },
          patient: { select: { id: true, address: true } },
          prescription: { select: { followUpAt: true } },
          callSession: { select: { startedAt: true, endedAt: true } }
        },
        orderBy: { startAt: 'desc' },
        take: 400
      });

      const operational = req.user.role === 'admin' ? await loadAdminOperationalMetrics() : null;

      const statusCounts = { booked: 0, completed: 0, cancelled: 0, no_show: 0 };
      let urgentCount = 0;
      let reminderDueCount = 0;
      let followUpCount = 0;
      let totalDurationMins = 0;
      let durationSamples = 0;

      const modeCounts = { video: 0, audio: 0, text: 0 };
      const uniquePatients = new Set();
      const doctorAggregate = new Map();
      const regionAggregate = new Map();
      const dailyTotals = {};
      const modeKpis = {
        video: { total: 0, completed: 0, noShow: 0 },
        audio: { total: 0, completed: 0, noShow: 0 },
        text: { total: 0, completed: 0, noShow: 0 }
      };

      const now = Date.now();
const next14Days = now + 14 * 24 * 60 * 60 * 1000;

      for (let i = 13; i >= 0; i -= 1) {
        const day = getIstDateKey(now - i * 24 * 60 * 60 * 1000);
        dailyTotals[day] = 0;
      }

      for (const appointment of appointments) {
        statusCounts[appointment.status] = (statusCounts[appointment.status] || 0) + 1;
        modeCounts[appointment.mode] = (modeCounts[appointment.mode] || 0) + 1;
        uniquePatients.add(appointment.patientId);

        const dayKey = getIstDateKey(appointment.startAt);
        if (Object.prototype.hasOwnProperty.call(dailyTotals, dayKey)) {
          dailyTotals[dayKey] += 1;
        }

        const triage = getAppointmentTriage(appointment);
        if (triage.level === 'critical' || triage.level === 'high') urgentCount += 1;

        const modeRow = modeKpis[appointment.mode] || modeKpis.video;
        modeRow.total += 1;
        if (appointment.status === 'completed') modeRow.completed += 1;
        if (appointment.status === 'no_show') modeRow.noShow += 1;

        const region = deriveRegion(appointment.patient?.address);
        if (!regionAggregate.has(region)) {
          regionAggregate.set(region, {
            region,
            total: 0,
            completed: 0,
            urgent: 0
          });
        }
        const regionRow = regionAggregate.get(region);
        regionRow.total += 1;
        if (appointment.status === 'completed') regionRow.completed += 1;
        if (triage.level === 'critical' || triage.level === 'high') regionRow.urgent += 1;

        const reminder = buildReminderInfo(appointment.startAt);
        if (appointment.status === 'booked' && reminder.dueSoon) reminderDueCount += 1;

        if (appointment.prescription?.followUpAt) {
          const followUpAt = new Date(appointment.prescription.followUpAt).getTime();
          if (followUpAt >= now && followUpAt <= next14Days) followUpCount += 1;
        }

        if (appointment.callSession?.startedAt && appointment.callSession?.endedAt) {
          const minutes = Math.round(
            (new Date(appointment.callSession.endedAt).getTime() - new Date(appointment.callSession.startedAt).getTime()) / 60000
          );
          if (minutes > 0) {
            totalDurationMins += minutes;
            durationSamples += 1;
          }
        }

        const doctorKey = appointment.doctorId;
        if (!doctorAggregate.has(doctorKey)) {
          doctorAggregate.set(doctorKey, {
            doctorId: doctorKey,
            doctorName: appointment.doctor?.fullName || 'Unknown doctor',
            total: 0,
            completed: 0,
            noShow: 0,
            urgent: 0
          });
        }

        const agg = doctorAggregate.get(doctorKey);
        agg.total += 1;
        if (appointment.status === 'completed') agg.completed += 1;
        if (appointment.status === 'no_show') agg.noShow += 1;
        if (triage.level === 'critical' || triage.level === 'high') agg.urgent += 1;
      }

      const total = appointments.length;
      const completionRate = total ? Math.round((statusCounts.completed / total) * 100) : 0;
      const avgConsultMins = durationSamples ? Math.round(totalDurationMins / durationSamples) : 0;

      const topDoctors = [...doctorAggregate.values()]
        .map((row) => ({
          ...row,
          completionRate: row.total ? Math.round((row.completed / row.total) * 100) : 0
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 6);

      const noShowRows = appointments.filter((row) => row.status === 'no_show');
      let recoveredNoShows = 0;
      noShowRows.forEach((noShow) => {
        const noShowAt = new Date(noShow.startAt).getTime();
        const hasRecovery = appointments.some((candidate) => {
          const candidateAt = new Date(candidate.startAt).getTime();
          return (
            candidate.patientId === noShow.patientId &&
            candidate.doctorId === noShow.doctorId &&
            candidateAt > noShowAt &&
            (candidate.status === 'booked' || candidate.status === 'completed')
          );
        });
        if (hasRecovery) recoveredNoShows += 1;
      });

      let refillAlertsNext7Days = null;
      let reviewedCompleted = null;
      let activeHelperLinks = null;

      if (req.user.role === 'admin') {
        try {
          refillAlertsNext7Days = await prisma.reminderJob.count({
            where: {
              status: 'scheduled',
              templateKey: 'prescription_refill_3d',
              sendAt: {
                gte: new Date(),
                lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
              }
            }
          });
        } catch (_error) {
          refillAlertsNext7Days = null;
        }

        try {
          reviewedCompleted = await prisma.appointment.count({
            where: {
              ...where,
              status: 'completed',
              review: { isNot: null }
            }
          });
        } catch (_error) {
          reviewedCompleted = null;
        }

        try {
          activeHelperLinks = await prisma.careSupportLink.count({ where: { isActive: true } });
        } catch (_error) {
          activeHelperLinks = null;
        }
      }

      const adminInsights =
        req.user.role === 'admin'
          ? {
              patientReach: uniquePatients.size,
              noShowRate: total ? Math.round((statusCounts.no_show / total) * 100) : 0,
              urgentRate: total ? Math.round((urgentCount / total) * 100) : 0,
              modeCounts,
              modeKpis: Object.entries(modeKpis).map(([mode, row]) => ({
                mode,
                total: row.total,
                completionRate: row.total ? Math.round((row.completed / row.total) * 100) : 0,
                noShowRate: row.total ? Math.round((row.noShow / row.total) * 100) : 0
              })),
              regionKpis: [...regionAggregate.values()]
                .map((row) => ({
                  ...row,
                  completionRate: row.total ? Math.round((row.completed / row.total) * 100) : 0,
                  urgentRate: row.total ? Math.round((row.urgent / row.total) * 100) : 0
                }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 8),
              impactKpis: {
                noShowCases: noShowRows.length,
                noShowRecoveryRate: noShowRows.length ? Math.round((recoveredNoShows / noShowRows.length) * 100) : 0,
                refillAlertsNext7Days,
                reviewCoverageRate:
                  reviewedCompleted == null || !statusCounts.completed
                    ? null
                    : Math.round((reviewedCompleted / statusCounts.completed) * 100),
                activeHelperLinks
              },
              topDoctors,
              dailySeries: Object.entries(dailyTotals).map(([day, count]) => ({ day, count })),
              operational
            }
          : null;

      return res.render('appointments-impact', {
        user: req.user,
        metrics: {
          total,
          statusCounts,
          completionRate,
          urgentCount,
          reminderDueCount,
          followUpCount,
          avgConsultMins,
          adminInsights
        }
      });
    } catch (e) {
      return next(e);
    }
  },

  cancel: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Appointment not found' });

      const isPatientOwner = req.user.role === 'patient' && req.user.id === appt.patientId;
      const isDoctorOwner = req.user.id === appt.doctorId;
      const isAdmin = req.user.role === 'admin';

      if (!isAdmin && !isDoctorOwner && !isPatientOwner) {
        return res.status(403).render('dashboard', { user: req.user, message: 'Forbidden' });
      }

      if (isPatientOwner && appt.status !== 'booked') {
        return res.status(409).render('dashboard', { user: req.user, message: 'Only booked appointments can be cancelled.' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { status: 'cancelled' }
        });
        if (appt.slotId) {
          await tx.slot.update({ where: { id: appt.slotId }, data: { status: 'available', appointment: { disconnect: true } } });
        }
      });

      await cancelScheduledRemindersForAppointment(appointmentId).catch(() => {});

      return res.redirect('/appointments');
    } catch (e) {
      return next(e);
    }
  }
,

  endAppointment: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Appointment not found' });

      if (req.user.role !== 'admin' && req.user.id !== appt.patientId && req.user.id !== appt.doctorId) {
        return res.status(403).render('dashboard', { user: req.user, message: 'Forbidden' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { status: 'completed' }
        });
        await tx.callSession.updateMany({
          where: { appointmentId },
          data: { status: 'ended', endedAt: new Date() }
        });
      });

      await cancelScheduledRemindersForAppointment(appointmentId).catch(() => {});

      return res.redirect(`/appointments/${appointmentId}`);
    } catch (e) {
      return next(e);
    }
  }
};

module.exports = { appointmentsController };
