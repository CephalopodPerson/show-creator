const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSafeName, checkNewName, resolveInside } = require('../server/lib/names');
const { startServer } = require('./helpers');

test('isSafeName rejects traversal and control characters', () => {
  for (const bad of ['', '..', '.hidden', 'a/b', 'a\\b', 'x\u0001y', 'x'.repeat(201)]) {
    assert.equal(isSafeName(bad), false, JSON.stringify(bad));
  }
  for (const good of ['Friday Night', 'Café 2026', 'Show #3', "Rob's (Live)"]) {
    assert.equal(isSafeName(good), true, good);
  }
});

test('checkNewName applies the stricter naming rule', () => {
  assert.deepEqual(checkNewName('Friday Night (Live)'), { ok: true, name: 'Friday Night (Live)' });
  assert.deepEqual(checkNewName('  Padded  '), { ok: true, name: 'Padded' });
  assert.equal(checkNewName('').ok, false);
  assert.equal(checkNewName('x'.repeat(61)).ok, false);
  assert.equal(checkNewName('<script>').ok, false);
  assert.equal(checkNewName('Show #3').ok, false);
  assert.equal(checkNewName(undefined).ok, false);
});

test('resolveInside only allows direct children', () => {
  assert.equal(resolveInside('/tmp/x', 'a'), '/tmp/x/a');
  assert.throws(() => resolveInside('/tmp/x', '..'));
  assert.throws(() => resolveInside('/tmp/x', 'a/b'));
});

test('every route rejects unsafe show names before doing anything', async () => {
  const t = await startServer();
  try {
    for (const [method, p] of [
      ['POST',   '/api/shows/%2E%2E/archive'],
      ['GET',    '/api/shows/..%2F..%2Fetc'],
      ['POST',   '/api/shows/a%2Fb/sequences'],
      ['DELETE', '/api/shows/%2Essh/uploads/x'],
      ['DELETE', '/api/archive/%2E%2E'],   // param check runs before requireAdmin
    ]) {
      const r = await t.raw(method, p);
      assert.equal(r.status, 400, `${method} ${p}`);
      assert.equal(r.body.error, 'invalid_name');
    }
  } finally { await t.close(); }
});
