const crypto = require('crypto');
const { prisma } = require('../models/db');
const { computeDoctorTrustScore } = require('../services/doctor-trust.service');
const {
  voiceIntentSchema,
  triagePreviewSchema,
  vitalsCreateSchema,
  qrTokenCreateSchema,
  carePlanCreateSchema,
  carePlanCheckInSchema,
  emergencyCreateSchema,
  externalThreadSchema,
  externalMessageSchema,
  voiceNoteSchema,
  secondOpinionCreateSchema,
  secondOpinionUpdateSchema,
  abhaLinkSchema,
  offlineSyncSchema
} = require('../models/schemas/innovation.schemas');

function formatIstDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });
}

function normalizePhone(value) {
  return String(value || '')
    .replace(/[^0-9]/g, '')
    .trim();
}

function helperPhoneWhere(phone) {
  const raw = String(phone || '').trim();
  const normalized = normalizePhone(phone);
  const tail10 = normalized.length >= 10 ? normalized.slice(-10) : '';

  const where = [];
  if (raw) where.push({ helperPhone: raw });
  if (normalized) where.push({ helperPhone: normalized });
  if (tail10) where.push({ helperPhone: { endsWith: tail10 } });
  return where;
}

async function getHelperAccessScope(user) {
  if (user.role !== 'help_worker') {
    return {
      appointmentPatientIds: new Set(),
      recordsPatientIds: new Set(),
      appointmentIds: new Set()
    };
  }

  const where = helperPhoneWhere(user.phone);
  if (!where.length) {
    return {
      appointmentPatientIds: new Set(),
      recordsPatientIds: new Set(),
      appointmentIds: new Set()
    };
  }

  const helpers = await prisma.careSupportLink.findMany({
    where: {
      isActive: true,
      OR: where
    },
    select: { id: true }
  });

  if (!helpers.length) {
    return {
      appointmentPatientIds: new Set(),
      recordsPatientIds: new Set(),
      appointmentIds: new Set()
    };
  }

  const rows = await prisma.consentAudit.findMany({
    where: {
      helperId: { in: helpers.map((item) => item.id) },
      isActive: true,
      scope: { in: ['all', 'appointment', 'records'] }
    },
    select: {
      patientId: true,
      appointmentId: true,
      scope: true
    }
  });

  const appointmentPatientIds = new Set();
  const recordsPatientIds = new Set();
  const appointmentIds = new Set();

  rows.forEach((row) => {
    if (row.scope === 'all') {
      if (row.patientId) {
        appointmentPatientIds.add(row.patientId);
        recordsPatientIds.add(row.patientId);
      }
      return;
    }

    if (row.scope === 'appointment') {
      if (row.appointmentId) appointmentIds.add(row.appointmentId);
      if (!row.appointmentId && row.patientId) appointmentPatientIds.add(row.patientId);
      return;
    }

    if (row.scope === 'records' && row.patientId) {
      recordsPatientIds.add(row.patientId);
    }
  });

  return {
    appointmentPatientIds,
    recordsPatientIds,
    appointmentIds
  };
}

async function canAccessPatient(user, patientId) {
  if (user.role === 'admin') return true;
  if (user.role === 'patient' && user.id === patientId) return true;

  if (user.role === 'doctor') {
    const linked = await prisma.appointment.findFirst({
      where: {
        doctorId: user.id,
        patientId
      },
      select: { id: true }
    });
    return Boolean(linked);
  }

  if (user.role === 'help_worker') {
    const scope = await getHelperAccessScope(user);
    return scope.recordsPatientIds.has(patientId) || scope.appointmentPatientIds.has(patientId);
  }

  return false;
}

async function ensureAppointmentAccess(appointmentId, user) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      doctor: { select: { id: true, fullName: true } },
      patient: { select: { id: true, fullName: true, patientProfile: true } },
      familyMember: true,
      prescription: true
    }
  });

  if (!appointment) return null;
  if (user.role === 'admin') return appointment;
  if (user.id === appointment.patientId || user.id === appointment.doctorId) return appointment;

  if (user.role === 'help_worker') {
    const scope = await getHelperAccessScope(user);
    if (scope.appointmentIds.has(appointment.id)) return appointment;
    if (scope.appointmentPatientIds.has(appointment.patientId)) return appointment;
  }

  return null;
}

async function buildPatientFullDetails(patientId) {
  const patient = await prisma.user.findUnique({
    where: { id: patientId },
    include: {
      patientProfile: true,
      familyMembers: {
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          fullName: true,
          relationToPatient: true,
          gender: true,
          dateOfBirth: true,
          chronicConditions: true,
          basicHealthInfo: true
        }
      },
      asPatientAppointments: {
        include: {
          doctor: { select: { id: true, fullName: true } },
          prescription: {
            select: {
              id: true,
              diagnosis: true,
              instructions: true,
              followUpAt: true,
              createdAt: true
            }
          }
        },
        orderBy: { startAt: 'desc' },
        take: 20
      }
    }
  });

  if (!patient) return null;

  const [recentVitals, recentDocuments, chronicCarePlans] = await Promise.all([
    prisma.consultationVital.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 20
    }),
    prisma.document.findMany({
      where: { ownerId: patientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        appointmentId: true,
        familyMemberId: true
      }
    }),
    prisma.chronicCarePlan.findMany({
      where: { patientId },
      include: {
        checkIns: {
          orderBy: { scheduledAt: 'desc' },
          take: 6
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 8
    })
  ]);

  return {
    patient: {
      id: patient.id,
      fullName: patient.fullName,
      phone: patient.phone,
      email: patient.email,
      gender: patient.gender,
      dateOfBirth: patient.dateOfBirth,
      address: patient.address,
      language: patient.language,
      chronicConditions: patient.patientProfile?.chronicConditions || null,
      basicHealthInfo: patient.patientProfile?.basicHealthInfo || null,
      abhaId: patient.patientProfile?.abhaId || null,
      abhaAddress: patient.patientProfile?.abhaAddress || null,
      familyMembers: patient.familyMembers
    },
    recentAppointments: patient.asPatientAppointments,
    recentVitals,
    recentDocuments,
    chronicCarePlans
  };
}

function computeTriage(problemDescription) {
  const text = String(problemDescription || '').toLowerCase();
  if (!text) {
    return {
      level: 'unknown',
      score: 0,
      label: 'Not assessed',
      recommendedAction: 'Add symptoms for triage guidance.'
    };
  }

  const emergencyTerms = [
    'chest pain',
    'unconscious',
    'stroke',
    'seizure',
    'cannot breathe',
    'bleeding heavily',
    'suicidal'
  ];
  const urgentTerms = ['high fever', 'severe pain', 'persistent vomiting', 'dehydration', 'wheezing'];
  const moderateTerms = ['cough', 'sore throat', 'headache', 'fatigue', 'rash'];

  let score = 0;
  emergencyTerms.forEach((term) => {
    if (text.includes(term)) score += 4;
  });
  urgentTerms.forEach((term) => {
    if (text.includes(term)) score += 2;
  });
  moderateTerms.forEach((term) => {
    if (text.includes(term)) score += 1;
  });

  if (score >= 6) {
    return {
      level: 'critical',
      score,
      label: 'Critical',
      recommendedAction: 'Seek immediate emergency care and escalate this case now.'
    };
  }
  if (score >= 3) {
    return {
      level: 'high',
      score,
      label: 'High',
      recommendedAction: 'Book the earliest available doctor and keep emergency contact ready.'
    };
  }
  if (score >= 1) {
    return {
      level: 'moderate',
      score,
      label: 'Moderate',
      recommendedAction: 'Book a routine consultation and monitor symptoms.'
    };
  }

  return {
    level: 'low',
    score,
    label: 'Low',
    recommendedAction: 'Continue self-monitoring and consult if symptoms persist.'
  };
}

function getVoiceIntent(transcript) {
  const text = String(transcript || '').toLowerCase();

  if (/emergency|help now|ambulance|urgent/.test(text)) {
    return {
      intent: 'emergency_escalation',
      route: '/innovations',
      actionLabel: 'Emergency escalation'
    };
  }

  if (/book|appointment|consult/.test(text)) {
    return {
      intent: 'book_appointment',
      route: '/book',
      actionLabel: 'Book appointment'
    };
  }

  if (/doctor|specialist|find doctor/.test(text)) {
    return {
      intent: 'browse_doctors',
      route: '/doctors',
      actionLabel: 'Browse doctors'
    };
  }

  if (/medicine|prescription|refill/.test(text)) {
    return {
      intent: 'medication_support',
      route: '/medicines',
      actionLabel: 'Medication and refill support'
    };
  }

  if (/support|helper|consent/.test(text)) {
    return {
      intent: 'care_support',
      route: '/support/consents',
      actionLabel: 'Care support and consent'
    };
  }

  return {
    intent: 'open_dashboard',
    route: '/dashboard',
    actionLabel: 'Open dashboard'
  };
}

function createRandomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function sanitizeMilestones(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 24);
}

function buildVitalsRisk(vital) {
  const flags = [];

  if (Number.isFinite(vital.bpSystolic) && vital.bpSystolic >= 180) flags.push('Very high systolic blood pressure');
  if (Number.isFinite(vital.bpDiastolic) && vital.bpDiastolic >= 120) flags.push('Very high diastolic blood pressure');
  if (Number.isFinite(vital.spo2Percent) && vital.spo2Percent < 92) flags.push('Low oxygen saturation');
  if (Number.isFinite(vital.temperatureC) && vital.temperatureC >= 39) flags.push('High temperature');
  if (Number.isFinite(vital.glucoseMgDl) && vital.glucoseMgDl >= 300) flags.push('High glucose');

  return {
    severity: flags.length >= 2 ? 'high' : flags.length ? 'moderate' : 'low',
    flags
  };
}

const innovationController = {
  voiceIntent: async (req, res, next) => {
    try {
      const parsed = voiceIntentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid voice command payload.' });
      }

      const intent = getVoiceIntent(parsed.data.transcript);
      return res.json({
        ok: true,
        transcript: parsed.data.transcript,
        language: parsed.data.language || req.user.language || 'en',
        ...intent
      });
    } catch (error) {
      return next(error);
    }
  },

  triagePreview: async (req, res, next) => {
    try {
      const parsed = triagePreviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid triage payload.' });
      }

      const triage = computeTriage(parsed.data.problemDescription);
      return res.json({
        ok: true,
        triage,
        shouldEscalate: triage.level === 'critical'
      });
    } catch (error) {
      return next(error);
    }
  },

  recordVitals: async (req, res, next) => {
    try {
      const appointment = await ensureAppointmentAccess(req.params.appointmentId, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });

      const parsed = vitalsCreateSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid vital payload.' });
      }

      const payload = parsed.data;
      const vital = await prisma.consultationVital.create({
        data: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          recordedById: req.user.id,
          source: payload.source || null,
          bpSystolic: payload.bpSystolic,
          bpDiastolic: payload.bpDiastolic,
          temperatureC: payload.temperatureC,
          glucoseMgDl: payload.glucoseMgDl,
          spo2Percent: payload.spo2Percent,
          pulseBpm: payload.pulseBpm,
          weightKg: payload.weightKg,
          notes: payload.notes || null
        }
      });

      return res.json({
        ok: true,
        vital,
        risk: buildVitalsRisk(vital)
      });
    } catch (error) {
      return next(error);
    }
  },

  listVitals: async (req, res, next) => {
    try {
      const appointment = await ensureAppointmentAccess(req.params.appointmentId, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });

      const vitals = await prisma.consultationVital.findMany({
        where: { appointmentId: appointment.id },
        orderBy: { createdAt: 'desc' },
        take: 80
      });

      return res.json({
        ok: true,
        vitals,
        latestRisk: vitals[0] ? buildVitalsRisk(vitals[0]) : null
      });
    } catch (error) {
      return next(error);
    }
  },

  createQrToken: async (req, res, next) => {
    try {
      const parsed = qrTokenCreateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid QR token payload.' });

      const allowed = await canAccessPatient(req.user, parsed.data.patientId);
      if (!allowed) return res.status(403).json({ error: 'Forbidden for this patient.' });

      const token = createRandomToken();
      const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000);

      const created = await prisma.patientAccessToken.create({
        data: {
          token,
          patientId: parsed.data.patientId,
          createdById: req.user.id,
          label: parsed.data.label || null,
          expiresAt
        }
      });

      return res.json({
        ok: true,
        accessToken: created,
        qrUrl: `/doctor/patient-access?token=${token}`
      });
    } catch (error) {
      return next(error);
    }
  },

  viewPatientFullDetails: async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId || '').trim();
      if (!patientId) return res.status(400).json({ error: 'Patient ID is required.' });

      const allowed = await canAccessPatient(req.user, patientId);
      if (!allowed) return res.status(403).json({ error: 'You do not have access to this patient.' });

      const details = await buildPatientFullDetails(patientId);
      if (!details) return res.status(404).json({ error: 'Patient not found.' });

      return res.json({ ok: true, source: 'patient-id', ...details });
    } catch (error) {
      return next(error);
    }
  },

  viewPatientByShareToken: async (req, res, next) => {
    try {
      if (!['doctor', 'admin', 'help_worker', 'patient'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Not permitted.' });
      }

      const tokenValue = String(req.params.token || '').trim();
      if (!tokenValue) return res.status(400).json({ error: 'Missing token.' });

      const token = await prisma.patientAccessToken.findUnique({
        where: { token: tokenValue }
      });

      if (!token) return res.status(404).json({ error: 'Invalid access token.' });
      if (token.revokedAt) return res.status(410).json({ error: 'Token has been revoked.' });
      if (new Date(token.expiresAt).getTime() < Date.now()) return res.status(410).json({ error: 'Token has expired.' });

      if (req.user.role === 'patient' && req.user.id !== token.patientId) {
        return res.status(403).json({ error: 'Patients can only view their own shared record.' });
      }

      const details = await buildPatientFullDetails(token.patientId);
      if (!details) return res.status(404).json({ error: 'Patient not found.' });

      await prisma.patientAccessToken.update({
        where: { id: token.id },
        data: { lastAccessedAt: new Date() }
      });

      return res.json({
        ok: true,
        source: 'share-token',
        ...details,
        tokenMeta: {
          label: token.label,
          expiresAt: token.expiresAt,
          lastAccessedAt: token.lastAccessedAt
        }
      });
    } catch (error) {
      return next(error);
    }
  },

  getPublicRecordByToken: async (req, res, next) => {
    try {
      const tokenValue = String(req.params.token || '').trim();
      if (!tokenValue) return res.status(400).json({ error: 'Missing token.' });

      const token = await prisma.patientAccessToken.findUnique({
        where: { token: tokenValue }
      });

      if (!token) return res.status(404).json({ error: 'Invalid access token.' });
      if (token.revokedAt) return res.status(410).json({ error: 'Token has been revoked.' });
      if (new Date(token.expiresAt).getTime() < Date.now()) return res.status(410).json({ error: 'Token has expired.' });

      const details = await buildPatientFullDetails(token.patientId);
      if (!details) return res.status(404).json({ error: 'Patient not found.' });

      await prisma.patientAccessToken.update({
        where: { id: token.id },
        data: { lastAccessedAt: new Date() }
      });

      return res.json({
        ok: true,
        consented: true,
        ...details,
        tokenMeta: {
          label: token.label,
          expiresAt: token.expiresAt,
          lastAccessedAt: token.lastAccessedAt
        }
      });
    } catch (error) {
      return next(error);
    }
  },

  createCarePlan: async (req, res, next) => {
    try {
      const parsed = carePlanCreateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid care plan payload.' });

      const allowed = await canAccessPatient(req.user, parsed.data.patientId);
      if (!allowed) return res.status(403).json({ error: 'Forbidden for this patient.' });

      const interval = Number(parsed.data.checkInIntervalDays || 30);
      const nextCheckInAt = new Date(Date.now() + interval * 24 * 60 * 60 * 1000);

      const plan = await prisma.chronicCarePlan.create({
        data: {
          patientId: parsed.data.patientId,
          familyMemberId: parsed.data.familyMemberId || null,
          createdById: req.user.id,
          condition: parsed.data.condition,
          status: 'active',
          checkInIntervalDays: interval,
          nextCheckInAt,
          milestones: sanitizeMilestones(parsed.data.milestones),
          notes: parsed.data.notes || null,
          checkIns: {
            create: {
              scheduledAt: nextCheckInAt,
              status: 'scheduled'
            }
          }
        },
        include: {
          checkIns: {
            orderBy: { scheduledAt: 'asc' },
            take: 4
          }
        }
      });

      return res.json({ ok: true, plan });
    } catch (error) {
      return next(error);
    }
  },

  listCarePlans: async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId || '').trim();
      const allowed = await canAccessPatient(req.user, patientId);
      if (!allowed) return res.status(403).json({ error: 'Forbidden for this patient.' });

      const plans = await prisma.chronicCarePlan.findMany({
        where: { patientId },
        include: {
          checkIns: {
            orderBy: { scheduledAt: 'desc' },
            take: 12
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return res.json({ ok: true, plans });
    } catch (error) {
      return next(error);
    }
  },

  createCarePlanCheckIn: async (req, res, next) => {
    try {
      const plan = await prisma.chronicCarePlan.findUnique({
        where: { id: req.params.planId }
      });
      if (!plan) return res.status(404).json({ error: 'Care plan not found.' });

      const allowed = await canAccessPatient(req.user, plan.patientId);
      if (!allowed) return res.status(403).json({ error: 'Forbidden for this care plan.' });

      const parsed = carePlanCheckInSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid check-in payload.' });

      const payload = parsed.data;
      const scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : new Date();

      const checkIn = await prisma.carePlanCheckIn.create({
        data: {
          planId: plan.id,
          appointmentId: payload.appointmentId || null,
          scheduledAt,
          completedAt: payload.completedAt ? new Date(payload.completedAt) : null,
          status: payload.status || 'scheduled',
          notes: payload.notes || null,
          vitalsSnapshot: payload.vitalsSnapshot || null
        }
      });

      if (checkIn.status === 'completed') {
        await prisma.chronicCarePlan.update({
          where: { id: plan.id },
          data: {
            nextCheckInAt: new Date(Date.now() + plan.checkInIntervalDays * 24 * 60 * 60 * 1000)
          }
        });
      }

      return res.json({ ok: true, checkIn });
    } catch (error) {
      return next(error);
    }
  },

  quickAmbulanceEscalation: async (req, res, next) => {
    try {
      if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Only patient accounts can initiate direct ambulance flow.' });
      }

      const parsed = emergencyCreateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid emergency payload.' });

      const patient = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { patientProfile: true }
      });
      if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

      const latestAppointment = await prisma.appointment.findFirst({
        where: { patientId: req.user.id },
        include: { prescription: true },
        orderBy: { startAt: 'desc' }
      });

      let sessionLocation = null;
      try {
        sessionLocation = req.cookies?.sessionLocation
          ? JSON.parse(req.cookies.sessionLocation)
          : null;
      } catch (_error) {
        sessionLocation = null;
      }

      const locationLat =
        parsed.data.locationLat ??
        (Number.isFinite(Number(sessionLocation?.latitude)) ? Number(sessionLocation.latitude) : undefined);
      const locationLng =
        parsed.data.locationLng ??
        (Number.isFinite(Number(sessionLocation?.longitude)) ? Number(sessionLocation.longitude) : undefined);

      const summaryParts = [
        `Patient: ${patient.fullName}`,
        patient.gender ? `Gender: ${patient.gender}` : null,
        patient.dateOfBirth ? `DOB: ${formatIstDate(patient.dateOfBirth)}` : null,
        patient.patientProfile?.chronicConditions
          ? `Chronic conditions: ${patient.patientProfile.chronicConditions}`
          : null,
        latestAppointment?.problemDescription
          ? `Current complaint: ${latestAppointment.problemDescription}`
          : null,
        latestAppointment?.prescription?.diagnosis
          ? `Latest diagnosis: ${latestAppointment.prescription.diagnosis}`
          : null
      ].filter(Boolean);

      const escalation = await prisma.emergencyEscalation.create({
        data: {
          patientId: patient.id,
          triggeredById: req.user.id,
          appointmentId: latestAppointment?.id || null,
          locationLat,
          locationLng,
          locationText:
            parsed.data.locationText ||
            patient.address ||
            (sessionLocation?.label ? String(sessionLocation.label) : null),
          contactName: patient.fullName,
          contactPhone: patient.phone || null,
          medicalSummary:
            parsed.data.medicalSummary ||
            summaryParts.join(' | ') ||
            'Emergency request from patient account.',
          latestVitals: parsed.data.latestVitals || null,
          status: 'open'
        }
      });

      return res.json({
        ok: true,
        escalation,
        ambulanceNumber: '108',
        message: 'Emergency escalation created and prepared for ambulance dispatch.'
      });
    } catch (error) {
      return next(error);
    }
  },

  escalateEmergency: async (req, res, next) => {
    try {
      const appointment = await ensureAppointmentAccess(req.params.appointmentId, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });

      const parsed = emergencyCreateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid emergency payload.' });

      const escalation = await prisma.emergencyEscalation.create({
        data: {
          patientId: appointment.patientId,
          triggeredById: req.user.id,
          appointmentId: appointment.id,
          locationLat: parsed.data.locationLat,
          locationLng: parsed.data.locationLng,
          locationText: parsed.data.locationText || null,
          contactName: parsed.data.contactName || null,
          contactPhone: parsed.data.contactPhone || null,
          medicalSummary: parsed.data.medicalSummary || appointment.problemDescription || null,
          latestVitals: parsed.data.latestVitals || null,
          status: 'open'
        }
      });

      return res.json({ ok: true, escalation, message: 'Emergency escalation created.' });
    } catch (error) {
      return next(error);
    }
  },

  listEmergencies: async (req, res, next) => {
    try {
      const where =
        req.user.role === 'admin'
          ? {}
          : req.user.role === 'doctor'
            ? { appointment: { doctorId: req.user.id } }
            : req.user.role === 'patient'
              ? { patientId: req.user.id }
              : { triggeredById: req.user.id };

      const emergencies = await prisma.emergencyEscalation.findMany({
        where,
        include: {
          patient: { select: { id: true, fullName: true } },
          appointment: { select: { id: true, startAt: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 80
      });

      return res.json({ ok: true, emergencies });
    } catch (error) {
      return next(error);
    }
  },

  upsertExternalThread: async (req, res, next) => {
    try {
      const appointment = await ensureAppointmentAccess(req.params.appointmentId, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });

      const parsed = externalThreadSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid external thread payload.' });

      const thread = await prisma.externalConsultThread.upsert({
        where: { appointmentId: appointment.id },
        update: {
          channel: parsed.data.channel,
          contactPhone: parsed.data.contactPhone || null
        },
        create: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          channel: parsed.data.channel,
          contactPhone: parsed.data.contactPhone || null
        }
      });

      return res.json({ ok: true, thread });
    } catch (error) {
      return next(error);
    }
  },

  postExternalMessage: async (req, res, next) => {
    try {
      const thread = await prisma.externalConsultThread.findUnique({
        where: { id: req.params.threadId },
        include: { appointment: true }
      });
      if (!thread) return res.status(404).json({ error: 'Thread not found.' });

      const appointment = await ensureAppointmentAccess(thread.appointmentId, req.user);
      if (!appointment) return res.status(403).json({ error: 'Forbidden for this thread.' });

      const parsed = externalMessageSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid external message payload.' });

      const message = await prisma.externalConsultMessage.create({
        data: {
          threadId: thread.id,
          direction: parsed.data.direction,
          body: parsed.data.body,
          syncedById: req.user.id,
          deliveryStatus: parsed.data.deliveryStatus || null,
          metadata: parsed.data.metadata || null
        }
      });

      await prisma.externalConsultThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date() }
      });

      return res.json({ ok: true, message });
    } catch (error) {
      return next(error);
    }
  },

  listExternalMessages: async (req, res, next) => {
    try {
      const thread = await prisma.externalConsultThread.findUnique({ where: { id: req.params.threadId } });
      if (!thread) return res.status(404).json({ error: 'Thread not found.' });

      const appointment = await ensureAppointmentAccess(thread.appointmentId, req.user);
      if (!appointment) return res.status(403).json({ error: 'Forbidden for this thread.' });

      const messages = await prisma.externalConsultMessage.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'asc' },
        take: 300
      });

      return res.json({ ok: true, thread, messages });
    } catch (error) {
      return next(error);
    }
  },

  createVoiceNote: async (req, res, next) => {
    try {
      const appointment = await ensureAppointmentAccess(req.params.appointmentId, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });

      const parsed = voiceNoteSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid voice note payload.' });

      const note = await prisma.consultationVoiceNote.create({
        data: {
          appointmentId: appointment.id,
          doctorId: appointment.doctorId,
          language: parsed.data.language || req.user.language || 'en',
          transcriptText: parsed.data.transcriptText,
          summaryText: parsed.data.summaryText || null,
          source: parsed.data.source || null
        }
      });

      return res.json({ ok: true, note });
    } catch (error) {
      return next(error);
    }
  },

  listVoiceNotes: async (req, res, next) => {
    try {
      const appointment = await ensureAppointmentAccess(req.params.appointmentId, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });

      const notes = await prisma.consultationVoiceNote.findMany({
        where: { appointmentId: appointment.id },
        orderBy: { createdAt: 'desc' },
        take: 40
      });

      return res.json({ ok: true, notes });
    } catch (error) {
      return next(error);
    }
  },

  patientTrends: async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId || '').trim();
      const allowed = await canAccessPatient(req.user, patientId);
      if (!allowed) return res.status(403).json({ error: 'Forbidden for this patient.' });

      const rows = await prisma.consultationVital.findMany({
        where: { patientId },
        orderBy: { createdAt: 'asc' },
        take: 240
      });

      const series = rows.map((row) => ({
        at: row.createdAt,
        bpSystolic: row.bpSystolic,
        bpDiastolic: row.bpDiastolic,
        glucoseMgDl: row.glucoseMgDl,
        spo2Percent: row.spo2Percent,
        pulseBpm: row.pulseBpm,
        weightKg: row.weightKg,
        temperatureC: row.temperatureC
      }));

      return res.json({
        ok: true,
        patientId,
        count: series.length,
        series
      });
    } catch (error) {
      return next(error);
    }
  },

  refillReminders: async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId || '').trim();
      const allowed = await canAccessPatient(req.user, patientId);
      if (!allowed) return res.status(403).json({ error: 'Forbidden for this patient.' });

      const appointments = await prisma.appointment.findMany({
        where: {
          patientId,
          prescription: { isNot: null }
        },
        include: {
          prescription: true,
          doctor: { select: { fullName: true } }
        },
        orderBy: { startAt: 'desc' },
        take: 40
      });

      const now = Date.now();
      const reminders = appointments
        .map((appointment) => {
          const followUpAt = appointment.prescription?.followUpAt ? new Date(appointment.prescription.followUpAt).getTime() : null;
          if (!followUpAt) return null;

          const days = Math.ceil((followUpAt - now) / (24 * 60 * 60 * 1000));
          const refillDue = days <= 7;

          return {
            appointmentId: appointment.id,
            diagnosis: appointment.prescription?.diagnosis || null,
            doctorName: appointment.doctor?.fullName || null,
            followUpAt: appointment.prescription?.followUpAt,
            daysUntilFollowUp: days,
            refillDue,
            guidance: refillDue
              ? 'Refill window is active. Confirm medicine availability and adherence.'
              : 'Refill reminder is scheduled for upcoming follow-up window.'
          };
        })
        .filter(Boolean);

      return res.json({ ok: true, reminders });
    } catch (error) {
      return next(error);
    }
  },

  linkAbha: async (req, res, next) => {
    try {
      if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Only patient accounts can link ABHA details.' });
      }

      const parsed = abhaLinkSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid ABHA payload.' });

      const updated = await prisma.user.update({
        where: { id: req.user.id },
        data: {
          patientProfile: {
            upsert: {
              create: {
                abhaId: parsed.data.abhaId,
                abhaAddress: parsed.data.abhaAddress || null,
                abhaLinkedAt: new Date()
              },
              update: {
                abhaId: parsed.data.abhaId,
                abhaAddress: parsed.data.abhaAddress || null,
                abhaLinkedAt: new Date()
              }
            }
          }
        },
        include: { patientProfile: true }
      });

      return res.json({
        ok: true,
        abha: {
          abhaId: updated.patientProfile?.abhaId,
          abhaAddress: updated.patientProfile?.abhaAddress,
          abhaLinkedAt: updated.patientProfile?.abhaLinkedAt
        }
      });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'ABHA ID already linked to another profile.' });
      }
      return next(error);
    }
  },

  getAbha: async (req, res, next) => {
    try {
      if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Only patient accounts can view ABHA status.' });
      }

      const me = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { patientProfile: true }
      });

      return res.json({
        ok: true,
        abha: {
          abhaId: me?.patientProfile?.abhaId || null,
          abhaAddress: me?.patientProfile?.abhaAddress || null,
          abhaLinkedAt: me?.patientProfile?.abhaLinkedAt || null
        }
      });
    } catch (error) {
      return next(error);
    }
  },

  createSecondOpinion: async (req, res, next) => {
    try {
      const appointment = await ensureAppointmentAccess(req.params.appointmentId, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });

      if (req.user.role !== 'patient' && req.user.role !== 'doctor' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden for second-opinion request.' });
      }

      const parsed = secondOpinionCreateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid second-opinion payload.' });

      const request = await prisma.secondOpinionRequest.create({
        data: {
          patientId: appointment.patientId,
          requestedById: req.user.id,
          appointmentId: appointment.id,
          secondDoctorId: parsed.data.secondDoctorId || null,
          consentNote: parsed.data.consentNote || null,
          status: 'requested',
          audits: {
            create: {
              actorId: req.user.id,
              action: 'second_opinion_requested',
              notes: parsed.data.consentNote || null
            }
          }
        },
        include: {
          audits: {
            orderBy: { createdAt: 'desc' },
            take: 5
          }
        }
      });

      return res.json({ ok: true, request });
    } catch (error) {
      return next(error);
    }
  },

  updateSecondOpinion: async (req, res, next) => {
    try {
      const current = await prisma.secondOpinionRequest.findUnique({ where: { id: req.params.requestId } });
      if (!current) return res.status(404).json({ error: 'Second-opinion request not found.' });

      const allowed =
        req.user.role === 'admin' ||
        req.user.id === current.patientId ||
        req.user.id === current.requestedById ||
        req.user.id === current.secondDoctorId;

      if (!allowed) return res.status(403).json({ error: 'Forbidden for this second-opinion request.' });

      const parsed = secondOpinionUpdateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid second-opinion update payload.' });

      const updated = await prisma.secondOpinionRequest.update({
        where: { id: current.id },
        data: {
          status: parsed.data.status,
          reviewSummary: parsed.data.reviewSummary || null,
          reviewedAt: parsed.data.status === 'completed' ? new Date() : null,
          audits: {
            create: {
              actorId: req.user.id,
              action: `second_opinion_${parsed.data.status}`,
              notes: parsed.data.notes || parsed.data.reviewSummary || null
            }
          }
        },
        include: {
          audits: {
            orderBy: { createdAt: 'desc' },
            take: 20
          }
        }
      });

      return res.json({ ok: true, request: updated });
    } catch (error) {
      return next(error);
    }
  },

  listSecondOpinionsByAppointment: async (req, res, next) => {
    try {
      const appointment = await ensureAppointmentAccess(req.params.appointmentId, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });

      const requests = await prisma.secondOpinionRequest.findMany({
        where: { appointmentId: appointment.id },
        include: {
          audits: {
            orderBy: { createdAt: 'desc' },
            take: 20
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return res.json({ ok: true, requests });
    } catch (error) {
      return next(error);
    }
  },

  doctorTrustScore: async (req, res, next) => {
    try {
      const doctorId = String(req.params.doctorId || '').trim();
      const doctor = await prisma.user.findUnique({
        where: { id: doctorId },
        select: { id: true, fullName: true, role: true }
      });
      if (!doctor || doctor.role !== 'doctor') return res.status(404).json({ error: 'Doctor not found.' });

      const trust = await computeDoctorTrustScore(doctorId);
      return res.json({ ok: true, doctor, trust });
    } catch (error) {
      return next(error);
    }
  },

  syncOfflineQueue: async (req, res, next) => {
    try {
      const parsed = offlineSyncSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid offline sync payload.' });

      const accepted = parsed.data.queue.map((item, index) => ({
        index,
        type: item.type,
        acceptedAt: new Date().toISOString(),
        status: 'received'
      }));

      return res.json({
        ok: true,
        accepted,
        pendingActions: accepted.filter((item) => item.type === 'book_appointment').length,
        message: 'Offline queue synced. Process pending actions from dashboard if required.'
      });
    } catch (error) {
      return next(error);
    }
  }
};

module.exports = { innovationController, computeTriage };
