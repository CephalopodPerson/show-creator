const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./password');

const SESSION_MS   = 4 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS      = 60 * 1000;
const MIN_PASSWORD = 8;

function createAdminAuth({ loadSettings, saveSettings }) {
  const sessions = new Map();   // token → { exp, mustChange }
  const failures = new Map();   // ip → { count, until }

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
    let f = failures.get(ip);
    if (f?.until && f.until <= now) { failures.delete(ip); f = undefined; }
    if (f?.until) {
      return res.status(429).json({ error: 'locked', retryAfter: Math.ceil((f.until - now) / 1000) });
    }

    const { ok, legacy } = checkPassword(req.body?.password ?? '');
    if (!ok) {
      const count = (f?.count ?? 0) + 1;
      failures.set(ip, { count, until: count >= MAX_FAILURES ? now + LOCK_MS : 0 });
      return res.status(401).json({ error: 'wrong_password' });
    }

    failures.delete(ip);
    purgeExpired();
    const token = crypto.randomUUID();
    sessions.set(token, { exp: now + SESSION_MS, mustChange: legacy });
    res.json({ token, mustChangePassword: legacy });
  }

  function changePassword(req, res) {
    const s = sessionFor(req);
    if (!s) return res.status(401).json({ error: 'admin_required' });

    const { currentPassword, newPassword } = req.body ?? {};
    if (!s.mustChange && !checkPassword(currentPassword ?? '').ok) {
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
    res.json({ ok: true });
  }

  return { isAdmin, requireAdmin, login, changePassword };
}

module.exports = { createAdminAuth };
