const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { prisma } = require('../models/db');
const { loginSchema, registerSchema, sessionLocationSchema } = require('../models/schemas/auth.schemas');
const { setSessionLocationCookie, clearSessionLocationCookie } = require('../middleware/auth');
const {
  createOrUpdateAuthUser,
  signInWithPassword,
  signOut
} = require('../services/supabase-auth.service');

function normalizePhone(value) {
  return String(value || '')
    .replace(/[^0-9]/g, '')
    .trim();
}

function formatSessionLocation(payload) {
  const latitude = Number(payload.latitude).toFixed(6);
  const longitude = Number(payload.longitude).toFixed(6);
  const accuracyMeters = Number(payload.accuracyMeters);
  if (Number.isFinite(accuracyMeters)) {
    return `${latitude},${longitude} (accuracy ${Math.round(accuracyMeters)}m)`;
  }
  return `${latitude},${longitude}`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function linkSupabaseUser(localUser, authUserId) {
  if (!localUser || !authUserId || localUser.supabaseAuthUserId === authUserId) return localUser;
  if (localUser.supabaseAuthUserId && localUser.supabaseAuthUserId !== authUserId) {
    throw new Error('Local user is already linked to a different Supabase Auth account.');
  }
  return prisma.user.update({
    where: { id: localUser.id },
    data: { supabaseAuthUserId: authUserId },
    include: { patientProfile: true, doctorProfile: true }
  });
}

async function ensureLegacyUserHasAuthAccount(req, res, user, password) {
  if (!user?.passwordHash) return null;

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) return null;

  const authUser = await createOrUpdateAuthUser({
    email: user.email,
    password,
    role: user.role,
    fullName: user.fullName,
    localUserId: user.id
  });

  await linkSupabaseUser(user, authUser.id);
  const session = await signInWithPassword(req, res, { email: user.email, password });
  return session.user;
}

const authController = {
  viewLogin: (req, res) => res.render('login', { user: req.user || null, error: null }),
  viewRegister: (req, res) => res.render('register', { user: req.user || null, error: null }),

  login: async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).render('login', { user: null, error: 'Invalid email/password.' });

      const { password } = parsed.data;
      const email = normalizeEmail(parsed.data.email);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) return res.status(401).render('login', { user: null, error: 'Invalid email/password.' });

      let authUser;
      try {
        const session = await signInWithPassword(req, res, { email, password });
        authUser = session.user;
      } catch (_error) {
        authUser = await ensureLegacyUserHasAuthAccount(req, res, user, password);
      }

      if (!authUser) {
        return res.status(401).render('login', { user: null, error: 'Invalid email/password.' });
      }

      await linkSupabaseUser(user, authUser.id);

      // A fresh login should always prompt a fresh browser location permission flow.
      clearSessionLocationCookie(res);
      res.clearCookie('token');
      return res.redirect('/dashboard');
    } catch (e) {
      return next(e);
    }
  },

  setSessionLocation: async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized.' });
      }

      if (req.user.role !== 'patient') {
        clearSessionLocationCookie(res);
        return res.status(403).json({ error: 'Only patient accounts can set session location.' });
      }

      const parsed = sessionLocationSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid location payload.' });
      }

      const sessionLocation = formatSessionLocation(parsed.data);
      setSessionLocationCookie(res, sessionLocation);
      return res.json({ ok: true, sessionLocation });
    } catch (e) {
      return next(e);
    }
  },

  register: async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).render('register', { user: null, error: 'Invalid form inputs.' });

      const data = { ...parsed.data, email: normalizeEmail(parsed.data.email) };

      if (data.role === 'admin') {
        const invite = process.env.ADMIN_INVITE_CODE;
        if (invite && data.adminInviteCode !== invite) {
          return res.status(403).render('register', { user: null, error: 'Admin invite code is invalid.' });
        }
      }

      if (data.role === 'doctor' && !data.specialization) {
        return res.status(400).render('register', { user: null, error: 'Doctor specialization is required.' });
      }

      if (data.role === 'help_worker') {
        const normalizedPhone = normalizePhone(data.phone);
        if (!normalizedPhone) {
          return res.status(400).render('register', { user: null, error: 'Help worker phone number is required.' });
        }
        if (!String(data.address || '').trim()) {
          return res.status(400).render('register', { user: null, error: 'Service area or address is required for help worker accounts.' });
        }
        if (!String(data.language || '').trim()) {
          return res.status(400).render('register', { user: null, error: 'Preferred language is required for help worker accounts.' });
        }
      }

      const existing = await prisma.user.findUnique({ where: { email: data.email } });
      if (existing) return res.status(409).render('register', { user: null, error: 'Email already registered.' });

      const localUserId = crypto.randomUUID();
      const authUser = await createOrUpdateAuthUser({
        email: data.email,
        password: data.password,
        role: data.role,
        fullName: data.fullName,
        localUserId
      });

      const created = await prisma.user.create({
        data: {
          id: localUserId,
          email: data.email,
          phone: normalizePhone(data.phone) || null,
          fullName: data.fullName,
          passwordHash: null,
          supabaseAuthUserId: authUser.id,
          role: data.role,
          gender: data.gender || null,
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
          address: data.address || null,
          language: data.language || null,
          timeZone: data.timeZone || null,
          doctorProfile:
            data.role === 'doctor'
              ? {
                  create: {
                    specialization: data.specialization,
                    yearsOfExperience: data.yearsOfExperience ? Number(data.yearsOfExperience) : null,
                    qualifications: data.qualifications || null,
                    clinicName: data.clinicName || null,
                    consultationLanguages: data.consultationLanguages || null,
                    description: data.description || null
                  }
                }
              : undefined,
          patientProfile: data.role === 'patient' ? { create: {} } : undefined
        }
      });

      await signInWithPassword(req, res, { email: data.email, password: data.password });
      clearSessionLocationCookie(res);
      res.clearCookie('token');
      return res.redirect('/dashboard');
    } catch (e) {
      return next(e);
    }
  },

  logout: async (req, res) => {
    await signOut(req, res).catch(() => {});
    res.clearCookie('token');
    clearSessionLocationCookie(res);
    return res.redirect('/auth/login');
  }
};

module.exports = { authController };
