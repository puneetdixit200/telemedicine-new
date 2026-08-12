const { prisma } = require('../models/db');
const { dispatchDueReminderJobs } = require('../services/reminder.service');
const { smsProviderConfig } = require('../services/sms.service');

function isReminderTableMissing(error) {
  return Boolean(
    error &&
      error.code === 'P2021' &&
      String(error.meta?.table || '')
        .toLowerCase()
        .includes('reminderjob')
  );
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

function summarizeTimeline(rows) {
  const summary = {
    scheduled: 0,
    sent: 0,
    failed: 0,
    skipped: 0
  };

  rows.forEach((row) => {
    if (summary[row.status] !== undefined) {
      summary[row.status] += 1;
    }
  });

  return summary;
}

function reminderGuidance(role, providerConfigured) {
  if (role === 'patient') {
    return providerConfigured
      ? 'Your reminders are auto-scheduled for SMS delivery. Keep your saved phone number current.'
      : 'Your reminder schedule is visible here. External SMS delivery is currently unavailable.';
  }
  if (role === 'help_worker') {
    return 'You can view reminder timelines for patients who delegated active support to your account.';
  }
  return providerConfigured
    ? 'Dispatch due SMS reminders to support low-connectivity patients.'
    : 'SMS provider is not configured. Due reminders will not be reported as sent until delivery is configured.';
}

const remindersController = {
  list: async (req, res, next) => {
    try {
      const providerConfigured = smsProviderConfig().configured;
      let where;
      if (req.user.role === 'patient') {
        where = { patientId: req.user.id };
      } else if (req.user.role === 'doctor') {
        where = { appointment: { doctorId: req.user.id } };
      } else if (req.user.role === 'help_worker') {
        const phoneWhere = helperPhoneWhere(req.user.phone);
        if (!phoneWhere.length) {
          return res.render('reminders', {
            user: req.user,
            timeline: [],
            summary: { scheduled: 0, sent: 0, failed: 0, skipped: 0 },
            unsupported: false,
            providerConfigured,
            guidance: 'Add your phone number in profile to receive delegated reminder visibility.'
          });
        }

        const helperLinks = await prisma.careSupportLink.findMany({
          where: {
            isActive: true,
            OR: phoneWhere
          },
          select: { id: true }
        });

        if (!helperLinks.length) {
          return res.render('reminders', {
            user: req.user,
            timeline: [],
            summary: { scheduled: 0, sent: 0, failed: 0, skipped: 0 },
            unsupported: false,
            providerConfigured,
            guidance: 'No delegated reminders are linked to your helper account yet.'
          });
        }

        const helperIds = helperLinks.map((link) => link.id);
        const consentRows = await prisma.consentAudit.findMany({
          where: {
            helperId: { in: helperIds },
            isActive: true,
            scope: { in: ['all', 'appointment'] }
          },
          select: { patientId: true }
        });

        const patientIds = [...new Set(consentRows.map((row) => row.patientId).filter(Boolean))];
        where = patientIds.length ? { patientId: { in: patientIds } } : { id: '__none__' };
      } else if (req.user.role === 'admin') {
        where = {};
      } else {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const timeline = await prisma.reminderJob.findMany({
        where,
        include: {
          patient: { select: { id: true, fullName: true, phone: true } },
          appointment: {
            select: {
              id: true,
              startAt: true,
              doctor: { select: { id: true, fullName: true } }
            }
          }
        },
        orderBy: { sendAt: 'desc' },
        take: 140
      });

      const summary = summarizeTimeline(timeline);
      return res.render('reminders', {
        user: req.user,
        timeline,
        summary,
        unsupported: false,
        providerConfigured,
        guidance: reminderGuidance(req.user.role, providerConfigured)
      });
    } catch (error) {
      if (!isReminderTableMissing(error)) return next(error);
      return res.render('reminders', {
        user: req.user,
        timeline: [],
        summary: { scheduled: 0, sent: 0, failed: 0, skipped: 0 },
        unsupported: true,
        providerConfigured: false,
        guidance: 'Reminder pipeline is disabled until the latest Prisma migration is applied.'
      });
    }
  },

  dispatchNow: async (req, res, next) => {
    try {
      if (req.user.role !== 'doctor' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only doctors or admins can dispatch reminders.' });
      }

      const limit = Number(req.body?.limit || 30);
      const result = await dispatchDueReminderJobs({
        limit,
        doctorId: req.user.role === 'doctor' ? req.user.id : null
      });

      if (result.unsupported) {
        return res.status(503).json({
          error: 'Reminder jobs table is missing. Run latest Prisma migration before dispatch.'
        });
      }

      return res.json({ ok: true, ...result });
    } catch (error) {
      return next(error);
    }
  }
};

module.exports = { remindersController, reminderGuidance };
