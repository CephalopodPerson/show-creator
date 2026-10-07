const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./password');
const { createLimiter } = require('./limiter');

const SESSION_MS   = 4 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS      = 60 * 1000;
const MIN_PASSWORD = 8;

function createAdminAuth({ loadSettings, saveSettings }) {
  const sessions = new Map();   // token → { exp, mustChange }
  const failures = createLimiter({ max: MAX_FAILURES, windowMs: LOCK_MS });   // keyed by ip

  function purgeExpired() {
    const now = Date.now();
    for (const [token, s] of sessions) if (s.exp < now) sessions.delete(token);
  }

  function sessionFor(req) {
    const token = req.headers['x-admin-token'];
    const s = token && sessions.get(token);
    if (!s || Date.now() > s.exp) return null;
    s.exp = Date.now() + SESSION_MS;   // sliding expiry
    return s;
  }

  // Before a password is set, the old PIN (settings → env → '1234') is accepted
  // and flagged so the session can do nothing but set a real password.
  function checkPassword(pw) {
    const s = loadSettings();
    if (s.adminPasswordHash) {
      return { ok: verifyPassword(pw, s.adminPasswordSalt, s.adminPasswordHash), legacy: false };
    }
    const legacy = s.adminPin || process.env.ADMIN_PIN || '1234';
    return { ok: String(pw) === String(legacy), legacy: true };
  }

  function isAdmin(req) {
    const s = sessionFor(req);
    return !!s && !s.mustChange;
  }

  function requireAdmin(req, res, next) {
    const s = sessionFor(req);
    if (!s) return res.status(401).json({ error: 'admin_required' });
    if (s.mustChange) return res.status(403).json({ error: 'password_change_required' });
    next();
  }

  function login(req, res) {
    const ip  = req.ip;
    const now = Date.now();
    const lock = failures.check(ip);
    if (lock.locked) return res.status(429).json({ error: 'locked', retryAfter: lock.retryAfter });

    const { ok, legacy } = checkPassword(req.body?.password ?? '');
    if (!ok) {
      failures.fail(ip);
      return res.status(401).json({ error: 'wrong_password' });
    }

    failures.reset(ip);
    purgeExpired();
    const token = crypto.randomUUID();
    sessions.set(token, { exp: now + SESSION_MS, mustChange: legacy });
    res.json({ token, mustChangePassword: legacy });
  }

  function changePassword(req, res) {
    const token = req.headers['x-admin-token'];
    const s = sessionFor(req);
    if (!s) return res.status(401).json({ error: 'admin_required' });

    // Once a real password exists, nobody — not even a leftover PIN
    // session — may replace it without knowing it.
    const { currentPassword, newPassword } = req.body ?? {};
    if (loadSettings().adminPasswordHash && !checkPassword(currentPassword ?? '').ok) {
      return res.status(401).json({ error: 'wrong_password', message: 'Current password is incorrect.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
      return res.status(400).json({ error: 'weak_password', message: `Use at least ${MIN_PASSWORD} characters.` });
    }

    const settings = loadSettings();
    const { salt, hash } = hashPassword(newPassword);
    settings.adminPasswordSalt = salt;
    settings.adminPasswordHash = hash;
    delete settings.adminPin;
    saveSettings(settings);
    s.mustChange = false;
    // Every other session was opened under the old credentials.
    for (const other of sessions.keys()) if (other !== token) sessions.delete(other);
    res.json({ ok: true });
  }

  return { isAdmin, requireAdmin, login, changePassword };
}

module.exports = { createAdminAuth };
