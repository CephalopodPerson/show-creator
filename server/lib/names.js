const path = require('path');

// Anything that could steer a filesystem path somewhere else.
const UNSAFE = /[/\\\u0000-\u001f\u007f]/;

/** Applied to every route: blocks traversal, keeps old show names working. */
function isSafeName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 200
    && !name.startsWith('.')
    && !UNSAFE.test(name);
}

const NEW_NAME = /^[\p{L}\p{N} _\-,'()&!]+$/u;

/** Applied only when a show is created: a readable, predictable name. */
function checkNewName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, message: 'Give the show a name.' };
  if (name.length > 60) return { ok: false, message: 'Show names can be at most 60 characters.' };
  if (!isSafeName(name) || !NEW_NAME.test(name)) {
    return { ok: false, message: "Use letters, numbers, spaces and - _ , ' ( ) & ! only." };
  }
  return { ok: true, name };
}

/** Join and verify the result is a direct child of dir — last line of defence. */
function resolveInside(dir, name) {
  const base = path.resolve(dir);
  const full = path.resolve(base, name);
  if (path.dirname(full) !== base) throw new Error('Path escapes base dir');
  return full;
}

module.exports = { isSafeName, checkNewName, resolveInside };
