const crypto = require('crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const actual   = crypto.scryptSync(String(pw), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
