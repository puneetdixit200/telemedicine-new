const { prisma } = require('../models/db');
const {
  createHelperSchema,
  toggleHelperSchema,
  createConsentSchema
} = require('../models/schemas/support.schemas');

function isSupportTableMissing(error) {
  const table = String(error?.meta?.table || '').toLowerCase();
  return Boolean(
    error &&
      error.code === 'P2021' &&
      (table.includes('caresupportlink') || table.includes('consentaudit'))
  );
}

function normalizePhone(value) {
  return String(value || '')
    .replace(/[^0-9]/g, '')
    .trim();
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

const supportController = {
  listConsents: async (req, res, next) => {
    try {
      if (req.user.role === 'patient') {
        const [helpers, activeConsents, history, upcomingAppointments] = await Promise.all([
          prisma.careSupportLink.findMany({
            where: { patientId: req.user.id },
            orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
            take: 60
          }),
          prisma.consentAudit.findMany({
            where: { patientId: req.user.id, isActive: true },
            include: {
              helper: true,
              appointment: {
                select: {
                  id: true,
                  startAt: true,
                  doctor: { select: { fullName: true } }
                }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 30
          }),
          prisma.consentAudit.findMany({
            where: { patientId: req.user.id },
            include: {
              helper: true,
              appointment: {
                select: {
                  id: true,
                  startAt: true,
                  doctor: { select: { fullName: true } }
                }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 80
          }),
          prisma.appointment.findMany({
            where: { patientId: req.user.id, status: 'booked', startAt: { gte: new Date() } },
            select: {
              id: true,
              startAt: true,
              familyMember: { select: { fullName: true } },
              doctor: { select: { fullName: true } }
            },
            orderBy: { startAt: 'asc' },
            take: 20
          })
        ]);

        return res.render('care-support', {
          user: req.user,
          canManage: true,
          helpers,
          activeConsents,
          history,
          upcomingAppointments,
          unsupported: false
        });
      }

      if (req.user.role === 'help_worker') {
        const helperPhoneWhere = buildHelperPhoneWhere(req.user.phone);

        if (!helperPhoneWhere.length) {
          return res.render('care-support', {
            user: req.user,
            canManage: false,
            helpers: [],
            activeConsents: [],
            history: [],
            upcomingAppointments: [],
            unsupported: false,
            guidance: 'Add your phone number in profile to receive delegated care assignments.'
          });
        }

        const helpers = await prisma.careSupportLink.findMany({
          where: {
            isActive: true,
            OR: helperPhoneWhere
          },
          include: {
            patient: { select: { id: true, fullName: true } }
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
          take: 100
        });

        if (!helpers.length) {
          return res.render('care-support', {
            user: req.user,
            canManage: false,
            helpers: [],
            activeConsents: [],
            history: [],
            upcomingAppointments: [],
            unsupported: false,
            guidance: 'No patient has linked your helper number yet.'
          });
        }

        const helperIds = helpers.map((helper) => helper.id);
        const history = await prisma.consentAudit.findMany({
          where: {
            helperId: { in: helperIds }
          },
          include: {
            helper: true,
            patient: { select: { id: true, fullName: true } },
            appointment: {
              select: {
                id: true,
                startAt: true,
                doctor: { select: { fullName: true } }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 160
        });

        return res.render('care-support', {
          user: req.user,
          canManage: false,
          helpers,
          activeConsents: history.filter((entry) => entry.isActive),
          history,
          upcomingAppointments: [],
          unsupported: false,
          guidance: 'You can assist only for patients with active consent linked to your helper phone.'
        });
      }

      const where = req.user.role === 'doctor' ? { appointment: { doctorId: req.user.id } } : req.user.role === 'admin' ? {} : { id: '__no_access__' };
      const history = await prisma.consentAudit.findMany({
        where,
        include: {
          helper: true,
          patient: { select: { id: true, fullName: true } },
          appointment: {
            select: {
              id: true,
              startAt: true,
              doctor: { select: { fullName: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 120
      });

      return res.render('care-support', {
        user: req.user,
        canManage: false,
        helpers: [],
        activeConsents: history.filter((entry) => entry.isActive),
        history,
        upcomingAppointments: [],
        unsupported: false
      });
    } catch (error) {
      if (!isSupportTableMissing(error)) return next(error);
      return res.render('care-support', {
        user: req.user,
        canManage: req.user.role === 'patient',
        helpers: [],
        activeConsents: [],
        history: [],
        upcomingAppointments: [],
        unsupported: true
      });
    }
  },

  createHelper: async (req, res, next) => {
    try {
      if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Only patient accounts can add helpers.' });
      }

      const parsed = createHelperSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid helper details.' });
      }

      const helperPhone = normalizePhone(parsed.data.helperPhone);
      if (!helperPhone) {
        return res.status(400).json({ error: 'Helper phone number is required.' });
      }

      const helper = await prisma.careSupportLink.create({
        data: {
          patientId: req.user.id,
          createdById: req.user.id,
          helperName: parsed.data.helperName,
          helperPhone,
          relationToPatient: parsed.data.relationToPatient || null,
          village: parsed.data.village || null,
          notes: parsed.data.notes || null,
          isActive: true
        }
      });

      await prisma.consentAudit.create({
        data: {
          patientId: req.user.id,
          helperId: helper.id,
          scope: 'all',
          action: 'helper_registered',
          notes: 'Helper profile created by patient.',
          isActive: true,
          grantedById: req.user.id
        }
      });

      return res.json({ ok: true, helper });
    } catch (error) {
      if (!isSupportTableMissing(error)) return next(error);
      return res.status(503).json({ error: 'Care-support tables are missing. Apply latest database migration.' });
    }
  },

  toggleHelper: async (req, res, next) => {
    try {
      if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Only patient accounts can update helpers.' });
      }

      const parsed = toggleHelperSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid helper status.' });
      }

      const helper = await prisma.careSupportLink.findFirst({
        where: { id: req.params.helperId, patientId: req.user.id }
      });
      if (!helper) return res.status(404).json({ error: 'Helper not found.' });

      const nextActive = typeof parsed.data.active === 'boolean' ? parsed.data.active : !helper.isActive;

      await prisma.$transaction(async (tx) => {
        await tx.careSupportLink.update({
          where: { id: helper.id },
          data: { isActive: nextActive }
        });

        if (!nextActive) {
          await tx.consentAudit.updateMany({
            where: { helperId: helper.id, isActive: true },
            data: { isActive: false, revokedAt: new Date(), action: 'consent_revoked' }
          });
        }

        await tx.consentAudit.create({
          data: {
            patientId: req.user.id,
            helperId: helper.id,
            scope: 'all',
            action: nextActive ? 'helper_activated' : 'helper_deactivated',
            notes: nextActive ? 'Patient enabled this helper.' : 'Patient disabled this helper.',
            isActive: nextActive,
            grantedById: req.user.id,
            revokedAt: nextActive ? null : new Date()
          }
        });
      });

      return res.json({ ok: true, helperId: helper.id, active: nextActive });
    } catch (error) {
      if (!isSupportTableMissing(error)) return next(error);
      return res.status(503).json({ error: 'Care-support tables are missing. Apply latest database migration.' });
    }
  },

  grantConsent: async (req, res, next) => {
    try {
      if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Only patient accounts can grant consent.' });
      }

      const parsed = createConsentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid consent request.' });
      }

      const helper = await prisma.careSupportLink.findFirst({
        where: {
          id: parsed.data.helperId,
          patientId: req.user.id,
          isActive: true
        }
      });
      if (!helper) return res.status(404).json({ error: 'Helper not found or inactive.' });

      const appointmentId = parsed.data.appointmentId || null;
      if (appointmentId) {
        const appointment = await prisma.appointment.findFirst({
          where: { id: appointmentId, patientId: req.user.id }
        });
        if (!appointment) {
          return res.status(404).json({ error: 'Appointment not found for consent scope.' });
        }
      }

      const consent = await prisma.consentAudit.create({
        data: {
          patientId: req.user.id,
          helperId: helper.id,
          appointmentId,
          scope: parsed.data.scope,
          action: 'consent_granted',
          notes: parsed.data.notes || null,
          isActive: true,
          grantedById: req.user.id
        },
        include: { helper: true }
      });

      return res.json({ ok: true, consent });
    } catch (error) {
      if (!isSupportTableMissing(error)) return next(error);
      return res.status(503).json({ error: 'Care-support tables are missing. Apply latest database migration.' });
    }
  }
};

module.exports = { supportController };
