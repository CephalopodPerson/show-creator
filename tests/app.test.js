const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

test('app boots and lists no shows', async () => {
  const t = await startServer();
  try {
    const r = await t.json('GET', '/api/shows');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  } finally { await t.close(); }
});

test('open UDP relay /api/osc is gone', async () => {
  const t = await startServer();
  try {
    const r = await t.json('POST', '/api/osc', { host: '10.0.0.5', port: 53, functionId: 1 });
    assert.equal(r.status, 404);
  } finally { await t.close(); }
});
