const { createServerClient } = require('@supabase/ssr');
const { createClient } = require('@supabase/supabase-js');
const { createHash } = require('crypto');

let adminClient;
const AUTH_USER_CACHE_TTL_MS = Number(process.env.SUPABASE_AUTH_CACHE_TTL_MS || 30_000);
const authUserCache = new Map();

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function requirePublicSupabaseEnv() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return { url, anonKey };
}

function getSupabaseAdminClient() {
  if (!adminClient) {
    const { url } = requirePublicSupabaseEnv();
    const serviceRoleKey = getSupabaseServiceRoleKey();
    if (!serviceRoleKey) {
      throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
    }
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  return adminClient;
}

function normalizeCookieOptions(options = {}) {
  const normalized = { ...options };
  if (typeof normalized.maxAge === 'number') {
    normalized.maxAge *= 1000;
  }
  return normalized;
}

function createSupabaseExpressClient(req, res) {
  const { url, anonKey } = requirePublicSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          if (req.cookies) req.cookies[name] = value;
          res.cookie(name, value, normalizeCookieOptions(options));
        });
      }
    }
  });
}

function getSupabaseSessionCacheKey(req) {
  const cookies = req?.cookies || {};
  const sessionCookies = Object.entries(cookies)
    .filter(([name, value]) => /^sb-.+-auth-token(?:\.\d+)?$/i.test(name) && value)
    .sort(([a], [b]) => a.localeCompare(b));

  if (!sessionCookies.length) return '';

  const fingerprint = sessionCookies.map(([name, value]) => `${name}=${value}`).join(';');
  return createHash('sha256').update(fingerprint).digest('hex');
}

function pruneAuthUserCache(now = Date.now()) {
  if (authUserCache.size < 500) return;
  for (const [key, entry] of authUserCache.entries()) {
    if (!entry || entry.expiresAt <= now) authUserCache.delete(key);
  }
}

function clearAuthUserCache(req) {
  const key = getSupabaseSessionCacheKey(req);
  if (key) authUserCache.delete(key);
}

async function signInWithPassword(req, res, { email, password }) {
  const supabase = createSupabaseExpressClient(req, res);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const wrapped = new Error(error.message || 'Supabase sign-in failed.');
    wrapped.cause = error;
    throw wrapped;
  }
  return data;
}

async function signOut(req, res) {
  clearAuthUserCache(req);
  const supabase = createSupabaseExpressClient(req, res);
  await supabase.auth.signOut();
}

async function getAuthenticatedSupabaseUser(req, res) {
  const cacheKey = getSupabaseSessionCacheKey(req);
  const now = Date.now();

  if (cacheKey) {
    const cached = authUserCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.user;
    if (cached) authUserCache.delete(cacheKey);
  }

  const supabase = createSupabaseExpressClient(req, res);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;

  if (cacheKey && AUTH_USER_CACHE_TTL_MS > 0) {
    pruneAuthUserCache(now);
    authUserCache.set(cacheKey, {
      user: data.user,
      expiresAt: now + AUTH_USER_CACHE_TTL_MS
    });
  }

  return data.user;
}

async function findAuthUserByEmail(email) {
  const admin = getSupabaseAdminClient();
  const normalizedEmail = String(email || '').trim().toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = (data?.users || []).find((user) => String(user.email || '').toLowerCase() === normalizedEmail);
    if (found) return found;
    if (!data?.users || data.users.length < 1000) return null;
  }

  return null;
}

async function createOrUpdateAuthUser({ email, password, role, fullName, localUserId }) {
  const admin = getSupabaseAdminClient();
  const existing = await findAuthUserByEmail(email);
  const metadata = {
    role,
    full_name: fullName,
    local_user_id: localUserId
  };

  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      email,
      password,
      email_confirm: true,
      app_metadata: metadata,
      user_metadata: metadata
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: metadata,
    user_metadata: metadata
  });
  if (error) throw error;
  return data.user;
}

module.exports = {
  clearAuthUserCache,
  createOrUpdateAuthUser,
  createSupabaseExpressClient,
  findAuthUserByEmail,
  getAuthenticatedSupabaseUser,
  getSupabaseAdminClient,
  getSupabaseAnonKey,
  getSupabaseSessionCacheKey,
  getSupabaseUrl,
  signInWithPassword,
  signOut
};
