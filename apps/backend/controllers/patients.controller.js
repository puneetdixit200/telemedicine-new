const { prisma } = require('../models/db');
const {
  patientHealthSchema,
  familyCreateSchema,
  familyUpdateSchema
} = require('../models/schemas/patients.schemas');

async function loadWorkspaceData(userId) {
  const [user, completedAppointments, recentDocuments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        language: true,
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
        }
      }
    }),
    prisma.appointment.findMany({
      where: { patientId: userId, status: 'completed' },
      select: {
        id: true,
        startAt: true,
        doctor: { select: { id: true, fullName: true } },
        familyMember: { select: { id: true, fullName: true } },
        prescription: { select: { id: true, diagnosis: true } }
      },
      orderBy: { startAt: 'desc' },
      take: 50
    }),
    prisma.document.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        createdAt: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        familyMember: { select: { id: true, fullName: true } },
        appointment: { select: { id: true, startAt: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 12
    })
  ]);

  return { user, completedAppointments, recentDocuments };
}

const patientsController = {
  viewWorkspace: async (req, res, next) => {
    try {
      const { user, completedAppointments, recentDocuments } = await loadWorkspaceData(req.user.id);
      return res.render('patient-workspace', {
        user,
        completedAppointments,
        recentDocuments,
        error: null,
        message: null
      });
    } catch (e) {
      return next(e);
    }
  },

  viewMyHealth: async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { patientProfile: true } });
      return res.render('patient-health', { user, error: null, message: null });
    } catch (e) {
      return next(e);
    }
  },

  updateMyHealth: async (req, res, next) => {
    try {
      const parsed = patientHealthSchema.safeParse(req.body);
      if (!parsed.success) {
        const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { patientProfile: true } });
        return res.status(400).render('patient-health', { user, error: 'Invalid input', message: null });
      }

      const updated = await prisma.user.update({
        where: { id: req.user.id },
        data: {
          patientProfile: {
            upsert: {
              create: {
                chronicConditions: parsed.data.chronicConditions || null,
                basicHealthInfo: parsed.data.basicHealthInfo || null
              },
              update: {
                chronicConditions: parsed.data.chronicConditions || null,
                basicHealthInfo: parsed.data.basicHealthInfo || null
              }
            }
          }
        },
        include: { patientProfile: true }
      });

      return res.render('patient-health', { user: updated, error: null, message: 'Saved.' });
    } catch (e) {
      return next(e);
    }
  }
,

  createFamilyMember: async (req, res, next) => {
    try {
      const parsed = familyCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        const { user, completedAppointments } = await loadWorkspaceData(req.user.id);
        return res.status(400).render('patient-workspace', {
          user,
          completedAppointments,
          error: 'Invalid family member input.',
          message: null
        });
      }

      await prisma.familyMember.create({
        data: {
          ownerPatientId: req.user.id,
          fullName: parsed.data.fullName,
          relationToPatient: parsed.data.relationToPatient || null,
          gender: parsed.data.gender || null,
          dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : null,
          chronicConditions: parsed.data.chronicConditions || null,
          basicHealthInfo: parsed.data.basicHealthInfo || null
        }
      });

      return res.redirect('/patients/workspace');
    } catch (e) {
      return next(e);
    }
  },

  updateFamilyMember: async (req, res, next) => {
    try {
      const parsed = familyUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        const { user, completedAppointments } = await loadWorkspaceData(req.user.id);
        return res.status(400).render('patient-workspace', {
          user,
          completedAppointments,
          error: 'Invalid family member update.',
          message: null
        });
      }

      const member = await prisma.familyMember.findFirst({
        where: { id: parsed.data.familyMemberId, ownerPatientId: req.user.id }
      });
      if (!member) return res.status(404).render('dashboard', { user: req.user, message: 'Family member not found' });

      await prisma.familyMember.update({
        where: { id: member.id },
        data: {
          fullName: parsed.data.fullName,
          relationToPatient: parsed.data.relationToPatient || null,
          gender: parsed.data.gender || null,
          dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : null,
          chronicConditions: parsed.data.chronicConditions || null,
          basicHealthInfo: parsed.data.basicHealthInfo || null
        }
      });

      return res.redirect('/patients/workspace');
    } catch (e) {
      return next(e);
    }
  }
};

module.exports = { patientsController };
