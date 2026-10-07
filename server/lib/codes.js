const crypto = require('crypto');

// No 0/O or 1/I/L — codes get read aloud and copied off paper.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

function normalizeCode(code) {
  return String(code ?? '').replace(/[\s-]+/g, '').toUpperCase();
}

// 1234, 4321, ABCD — each character one step from the last.
function isStraightRun(s) {
  if (s.length < 2) return false;
  const step = s.charCodeAt(1) - s.charCodeAt(0);
  if (Math.abs(step) !== 1) return false;
  for (let i = 2; i < s.length; i++) {
    if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false;
  }
  return true;
}

function checkCustomCode(raw) {
  const code = String(raw ?? '').trim();
  const n = normalizeCode(code);
  if (n.length < 4) return { ok: false, message: 'Codes need at least 4 characters.' };
  if (code.length > 32) return { ok: false, message: 'Codes can be at most 32 characters.' };
  // Codes travel in an HTTP header, which only carries plain ASCII.
  if (!/^[\x20-\x7e]+$/.test(code)) {
    return { ok: false, message: 'Use letters, numbers and symbols from a standard keyboard.' };
  }
  if (/^(.)\1+$/.test(n) || isStraightRun(n)) {
    return { ok: false, message: 'That code is too easy to guess.' };
  }
  return { ok: true, code };
}

function codesMatch(stored, given) {
  const a = Buffer.from(normalizeCode(stored));
  const b = Buffer.from(normalizeCode(given));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { generateCode, normalizeCode, checkCustomCode, codesMatch };
