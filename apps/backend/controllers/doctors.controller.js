const { prisma } = require('../models/db');
const { bulkSchema, callStateSchema } = require('../models/schemas/doctors.schemas');
const { isRecentlyOnline } = require('../services/presence.service');
const { computeDoctorTrustScore, computeDoctorTrustScores } = require('../services/doctor-trust.service');

function isMissingDoctorReviewTable(error) {
  return Boolean(
    error &&
      error.code === 'P2021' &&
      String(error.meta?.table || '')
        .toLowerCase()
        .includes('doctorreview')
  );
}

function getUtcRangeForIstDate(dateStr) {
  const start = new Date(`${dateStr}T00:00:00.000+05:30`);
  const end = new Date(`${dateStr}T23:59:59.999+05:30`);
  return { start, end };
}

function getIstDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(date));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function startOfIstDay(date) {
  return getUtcRangeForIstDate(getIstDateKey(date)).start;
}

function istHourOnDate(dateStr, hour) {
  const base = getUtcRangeForIstDate(dateStr).start;
  base.setUTCMinutes(base.getUTCMinutes() + Number(hour) * 60);
  return base;
}

const FEEDBACK_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'were',
  'very',
  'good',
  'great',
  'doctor',
  'dr',
  'been',
  'help',
  'helpful',
  'about',
  'your',
  'they',
  'them',
  'into',
  'than',
  'after',
  'before',
  'when',
  'what',
  'will',
  'just',
  'only',
  'much',
  'more',
  'less',
  'felt',
  'feel',
  'pain',
  'care'
]);

function extractTopFeedbackKeywords(reviews, limit = 5) {
  const counts = new Map();

  (Array.isArray(reviews) ? reviews : []).forEach((review) => {
    const text = String(review?.comment || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ');

    text
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !FEEDBACK_STOPWORDS.has(token))
      .forEach((token) => {
        counts.set(token, (counts.get(token) || 0) + 1);
      });
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

const doctorsController = {
  listDoctors: async (req, res, next) => {
    try {
      if (req.user.role === 'doctor') {
        return res.redirect('/doctors/me/slots');
      }

      const { specialization, language, online } = req.query;
      const where = {
        role: 'doctor',
        isActive: true,
        doctorProfile: {
          is: {
            ...(specialization ? { specialization: { contains: String(specialization), mode: 'insensitive' } } : {}),
            ...(language ? { consultationLanguages: { contains: String(language), mode: 'insensitive' } } : {})
          }
        }
      };

      const doctors = await prisma.user.findMany({
        where,
        include: { doctorProfile: true },
        orderBy: { fullName: 'asc' }
      });

      const doctorIds = doctors.map((d) => d.id);
      let trustByDoctorId = new Map();
      try {
        trustByDoctorId = await computeDoctorTrustScores(doctorIds);
      } catch (_error) {
        trustByDoctorId = new Map();
      }

      const doctorsWithStatus = doctors.map((d) => ({
        ...d,
        online: Boolean(d.doctorProfile?.callEnabled) && isRecentlyOnline(d.lastSeenAt),
        ratingAverage: trustByDoctorId.get(d.id)?.metrics?.ratingAverage || 0,
        ratingCount: trustByDoctorId.get(d.id)?.metrics?.ratingCount || 0,
        trust: trustByDoctorId.get(d.id) || { score: 0, band: 'new_or_recovering', metrics: null }
      }));

      const doctorsFiltered =
        online === 'online'
          ? doctorsWithStatus.filter((d) => d.online)
          : online === 'offline'
            ? doctorsWithStatus.filter((d) => !d.online)
            : doctorsWithStatus;

      return res.render('doctors', {
        user: req.user,
        doctors: doctorsFiltered,
        specialization: specialization || '',
        language: language || '',
        online: online || 'all'
      });
    } catch (e) {
      return next(e);
    }
  },

  viewDoctor: async (req, res, next) => {
    try {
      const doctorId = req.params.doctorId;
      if (req.user.role === 'doctor' && req.user.id !== doctorId) {
        return res.status(403).render('dashboard', { user: req.user, message: 'Doctors cannot access other doctor profiles.' });
      }

      const doctor = await prisma.user.findUnique({
        where: { id: doctorId },
        include: { doctorProfile: true }
      });
      if (!doctor || doctor.role !== 'doctor') return res.status(404).render('dashboard', { user: req.user, message: 'Doctor not found' });

      let ratingAggregate = { _avg: { rating: 0 }, _count: { _all: 0 } };
      let recentReviews = [];
      try {
        const reviewData = await Promise.all([
          prisma.doctorReview.aggregate({
            where: { doctorId },
            _avg: { rating: true },
            _count: { _all: true }
          }),
          prisma.doctorReview.findMany({
            where: { doctorId },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
              patient: {
                select: { id: true, fullName: true }
              }
            }
          })
        ]);
        ratingAggregate = reviewData[0];
        recentReviews = reviewData[1];
      } catch (error) {
        if (!isMissingDoctorReviewTable(error)) throw error;
      }

      const now = new Date();
      const slots = await prisma.slot.findMany({
        where: { doctorId, startAt: { gte: now } },
        orderBy: { startAt: 'asc' },
        take: 48
      });

      const familyMembers =
        req.user.role === 'patient'
          ? await prisma.familyMember.findMany({
              where: { ownerPatientId: req.user.id },
              orderBy: { fullName: 'asc' }
            })
          : [];

      const doctorOnline = Boolean(doctor.doctorProfile?.callEnabled) && isRecentlyOnline(doctor.lastSeenAt);
      let trust = { score: 0, band: 'new_or_recovering', metrics: null };
      try {
        trust = await computeDoctorTrustScore(doctorId);
      } catch (_error) {
        trust = { score: 0, band: 'new_or_recovering', metrics: null };
      }

      return res.render('doctor', {
        user: req.user,
        doctor,
        slots,
        doctorOnline,
        familyMembers,
        doctorRating: {
          average: ratingAggregate._avg.rating || 0,
          count: ratingAggregate._count._all || 0
        },
        trust,
        recentReviews
      });
    } catch (e) {
      return next(e);
    }
  },

  viewMySlots: async (req, res, next) => {
    try {
      const doctor = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { doctorProfile: true }
      });
      const now = new Date();
      const slots = await prisma.slot.findMany({
        where: { doctorId: req.user.id, startAt: { gte: now } },
        orderBy: { startAt: 'asc' },
        take: 96
      });
      return res.render('doctor-slots', {
        user: doctor || req.user,
        slots,
        error: null,
        message: null,
        callState: doctor?.doctorProfile?.callEnabled ? 'online' : 'offline',
        statusMessage: doctor?.doctorProfile?.statusMessage || ''
      });
    } catch (e) {
      return next(e);
    }
  },

  viewAnalytics: async (req, res, next) => {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      const start = startOfIstDay(sevenDaysAgo);

      const appts = await prisma.appointment.findMany({
        where: {
          doctorId: req.user.id,
          startAt: { gte: start }
        },
        select: { startAt: true, status: true }
      });

      const statusCounts = { booked: 0, completed: 0, cancelled: 0, no_show: 0 };
      const byDay = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
        byDay[getIstDateKey(d)] = 0;
      }

      appts.forEach((a) => {
        statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
        const key = getIstDateKey(a.startAt);
        if (Object.prototype.hasOwnProperty.call(byDay, key)) byDay[key] += 1;
      });

      const maxDaily = Math.max(1, ...Object.values(byDay));
      const dailySeries = Object.entries(byDay).map(([day, count]) => ({
        day,
        count,
        widthPct: Math.round((count / maxDaily) * 100)
      }));

      let reviewRows = [];
      try {
        reviewRows = await prisma.doctorReview.findMany({
          where: {
            doctorId: req.user.id,
            createdAt: { gte: start }
          },
          select: {
            rating: true,
            comment: true
          }
        });
      } catch (error) {
        if (!isMissingDoctorReviewTable(error)) throw error;
      }

      const reviewCount = reviewRows.length;
      const averageRating = reviewCount
        ? Number((reviewRows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / reviewCount).toFixed(1))
        : 0;
      const topFeedbackKeywords = extractTopFeedbackKeywords(reviewRows, 6);

      const rebookRows = await prisma.appointment.findMany({
        where: {
          doctorId: req.user.id,
          startAt: { gte: new Date(start.getTime() - 21 * 24 * 60 * 60 * 1000) }
        },
        select: {
          patientId: true,
          startAt: true,
          status: true
        },
        orderBy: { startAt: 'asc' }
      });

      const byPatient = new Map();
      rebookRows.forEach((row) => {
        if (!byPatient.has(row.patientId)) {
          byPatient.set(row.patientId, []);
        }
        byPatient.get(row.patientId).push(row);
      });

      const completedThisWeek = rebookRows.filter(
        (row) => row.status === 'completed' && new Date(row.startAt).getTime() >= start.getTime()
      );

      let rebookedCount = 0;
      completedThisWeek.forEach((row) => {
        const timeline = byPatient.get(row.patientId) || [];
        const sourceMs = new Date(row.startAt).getTime();
        const hasRebook = timeline.some((next) => {
          const nextMs = new Date(next.startAt).getTime();
          return nextMs > sourceMs && (next.status === 'booked' || next.status === 'completed');
        });
        if (hasRebook) rebookedCount += 1;
      });

      const rebookRate = completedThisWeek.length ? Math.round((rebookedCount / completedThisWeek.length) * 100) : 0;

      return res.render('doctor-analytics', {
        user: req.user,
        statusCounts,
        dailySeries,
        weeklyDigest: {
          averageRating,
          reviewCount,
          topFeedbackKeywords,
          rebookRate,
          completedConsults: completedThisWeek.length
        }
      });
    } catch (e) {
      return next(e);
    }
  },

  setCallState: async (req, res, next) => {
    try {
      const parsed = callStateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).render('dashboard', { user: req.user, message: 'Invalid call state.' });
      }

      const callEnabled = parsed.data.state === 'online';
      const statusMessage = String(parsed.data.statusMessage || '').trim();
      await prisma.user.update({
        where: { id: req.user.id },
        data: {
          lastSeenAt: new Date(),
          doctorProfile: {
            upsert: {
              create: {
                specialization: 'General',
                callEnabled,
                statusMessage: callEnabled ? null : statusMessage || null
              },
              update: {
                callEnabled,
                statusMessage: callEnabled ? null : statusMessage || null
              }
            }
          }
        }
      });

      return res.redirect('/doctors/me/slots');
    } catch (e) {
      return next(e);
    }
  },

  bulkUpdateSlots: async (req, res, next) => {
    try {
      const parsed = bulkSchema.safeParse(req.body);
      if (!parsed.success) {
        const doctor = await prisma.user.findUnique({
          where: { id: req.user.id },
          include: { doctorProfile: true }
        });
        const slots = await prisma.slot.findMany({ where: { doctorId: req.user.id }, orderBy: { startAt: 'asc' }, take: 96 });
        return res.status(400).render('doctor-slots', {
          user: doctor || req.user,
          slots,
          error: 'Invalid input',
          message: null,
          callState: doctor?.doctorProfile?.callEnabled ? 'online' : 'offline',
          statusMessage: doctor?.doctorProfile?.statusMessage || ''
        });
      }

      const { date, action } = parsed.data;

      // Generate 15-min slots 09:00-17:00 IST by default.
      const startHour = parsed.data.startHourUtc ? Number(parsed.data.startHourUtc) : 9;
      const endHour = parsed.data.endHourUtc ? Number(parsed.data.endHourUtc) : 17;

      const base = istHourOnDate(date, startHour);
      const limit = istHourOnDate(date, endHour);

      const targets = [];
      for (let t = base.getTime(); t < limit.getTime(); t += 15 * 60 * 1000) {
        targets.push(new Date(t));
      }

      const status = action === 'make_available' ? 'available' : 'busy';

      await prisma.$transaction(
        targets.map((startAt) =>
          prisma.slot.upsert({
            where: { doctorId_startAt: { doctorId: req.user.id, startAt } },
            update: {
              status: status,
              appointment: status === 'busy' ? { disconnect: true } : undefined
            },
            create: { doctorId: req.user.id, startAt, status }
          })
        )
      );

      const slots = await prisma.slot.findMany({
        where: { doctorId: req.user.id, startAt: { gte: new Date() } },
        orderBy: { startAt: 'asc' },
        take: 96
      });
      const doctor = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { doctorProfile: true }
      });
      return res.render('doctor-slots', {
        user: doctor || req.user,
        slots,
        error: null,
        message: 'Slots updated.',
        callState: doctor?.doctorProfile?.callEnabled ? 'online' : 'offline',
        statusMessage: doctor?.doctorProfile?.statusMessage || ''
      });
    } catch (e) {
      return next(e);
    }
  }
};

module.exports = { doctorsController };
