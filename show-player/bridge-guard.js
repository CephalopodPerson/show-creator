const fs   = require('fs');
const path = require('path');

/** The bridge only ever launches QLC+ itself. */
function isAllowedQlcExe(p) {
  if (typeof p !== 'string' || !p) return false;
  const base = path.basename(p.replace(/\\/g, '/')).toLowerCase();
  if (base !== 'qlcplus' && base !== 'qlcplus.exe') return false;
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * Every request must carry the per-launch token that main.js handed the page.
 * Other web pages on this machine can reach 127.0.0.1 but can't know it.
 */
function requireToken(token) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (!token || req.get('x-bridge-token') !== token) {
      return res.status(403).json({ error: 'bad_token' });
    }
    return next();
  };
}

module.exports = { isAllowedQlcExe, requireToken };
