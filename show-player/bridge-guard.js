const fs   = require('fs');
const path = require('path');

const qlcExeBase = p => path.basename(String(p).replace(/\\/g, '/')).toLowerCase();

/** QLC+ 4 ships as qlcplus(.exe), QLC+ 5 as qlcplus5(.exe). */
function isQlc5(p) {
  return /^qlcplus5(\.exe)?$/.test(qlcExeBase(p));
}

/** The bridge only ever launches QLC+ itself. */
function isAllowedQlcExe(p) {
  if (typeof p !== 'string' || !p) return false;
  if (!/^qlcplus5?(\.exe)?$/.test(qlcExeBase(p))) return false;
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * Every request must carry the per-launch token that main.js handed the page.
 * Other web pages on this machine can reach 127.0.0.1 but can't know it.
 * An <audio> element can't send headers, so it may pass the token as ?t=.
 */
function requireToken(token) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const sent = req.get('x-bridge-token') ?? req.query?.t;
    if (!token || sent !== token) {
      return res.status(403).json({ error: 'bad_token' });
    }
    return next();
  };
}

module.exports = { isAllowedQlcExe, isQlc5, requireToken };
