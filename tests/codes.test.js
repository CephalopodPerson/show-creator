const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateCode, normalizeCode, checkCustomCode, codesMatch } = require('../server/lib/codes');

test('generated codes use the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    assert.match(generateCode(), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/);
  }
});

test('normalizeCode ignores case, spaces and dashes', () => {
  assert.equal(normalizeCode(' k7m 4qx '), 'K7M4QX');
  assert.equal(normalizeCode('K7M-4QX'), 'K7M4QX');
  assert.equal(normalizeCode(undefined), '');
});

test('checkCustomCode rejects weak or unusable codes', () => {
  for (const bad of ['abc', '1234', '4321', 'abcd', 'AAAA', '0000', 'x'.repeat(33), 'café1', '']) {
    assert.equal(checkCustomCode(bad).ok, false, bad);
  }
  assert.deepEqual(checkCustomCode('Blue Moon'), { ok: true, code: 'Blue Moon' });
  assert.deepEqual(checkCustomCode(' 7391 '), { ok: true, code: '7391' });
});

test('codesMatch compares normalized codes', () => {
  assert.equal(codesMatch('K7M-4QX', 'k7m 4qx'), true);
  assert.equal(codesMatch('Blue Moon', 'BLUE-MOON'), true);
  assert.equal(codesMatch('K7M-4QX', 'K7M-4QY'), false);
  assert.equal(codesMatch('K7M-4QX', 'K7M'), false);
  assert.equal(codesMatch(undefined, ''), false);
  assert.equal(codesMatch('', ''), false);
});

test('checkCustomCode rejects non-text input', () => {
  for (const bad of [{ toString: () => 'Blue Moon' }, ['Blue', 'Moon'], 73915]) {
    assert.deepEqual(checkCustomCode(bad), { ok: false, message: 'Codes must be text.' });
  }
});
