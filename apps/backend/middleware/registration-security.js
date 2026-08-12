const crypto = require('crypto');

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAdminInvite(req, res, next) {
  const role = String(req.body?.role || '').trim().toLowerCase();
  if (role !== 'admin') return next();

  const configuredInvite = String(process.env.ADMIN_INVITE_CODE || '').trim();
  if (!configuredInvite) {
    return res.status(503).render('register', {
      user: null,
      error: 'Admin self-registration is disabled because no admin invite is configured.'
    });
  }

  const suppliedInvite = String(req.body?.adminInviteCode || '').trim();
  if (!safeEqual(configuredInvite, suppliedInvite)) {
    return res.status(403).render('register', {
      user: null,
      error: 'Admin invite code is invalid.'
    });
  }

  return next();
}

module.exports = { requireAdminInvite, safeEqual };
