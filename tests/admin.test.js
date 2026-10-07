const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

const H = token => ({ 'x-admin-token': token });

test('legacy PIN works once and forces a password change', async () => {
  const t = await startServer();
  try {
    const login = await t.json('POST', '/api/admin/login', { password: '1234' });
    assert.equal(login.status, 200);
    assert.equal(login.body.mustChangePassword, true);
    const tok = login.body.token;

    assert.equal((await t.json('GET', '/api/archive', undefined, H(tok))).body.error, 'password_change_required');
    assert.equal((await t.json('POST', '/api/admin/password', { newPassword: 'short' }, H(tok))).status, 400);
    assert.equal((await t.json('POST', '/api/admin/password', { newPassword: 'correct horse' }, H(tok))).status, 200);
    assert.equal((await t.json('GET', '/api/archive', undefined, H(tok))).status, 200);

    const saved = JSON.parse(fs.readFileSync(path.join(t.root, 'data', 'settings.json'), 'utf8'));
    assert.ok(saved.adminPasswordHash);
    assert.equal(saved.adminPin, undefined);

    assert.equal((await t.json('POST', '/api/admin/login', { password: '1234' })).status, 401);
    const again = await t.json('POST', '/api/admin/login', { password: 'correct horse' });
    assert.equal(again.status, 200);
    assert.equal(again.body.mustChangePassword, false);
  } finally { await t.close(); }
});

test('a PIN previously set in settings.json is the legacy password', async () => {
  const t = await startServer({ settings: { adminPin: '9999' } });
  try {
    assert.equal((await t.json('POST', '/api/admin/login', { password: '1234' })).status, 401);
    const r = await t.json('POST', '/api/admin/login', { password: '9999' });
    assert.equal(r.status, 200);
    assert.equal(r.body.mustChangePassword, true);
  } finally { await t.close(); }
});

test('changing password later requires the current password', async () => {
  const t = await startServer();
  try {
    const tok = (await t.json('POST', '/api/admin/login', { password: '1234' })).body.token;
    await t.json('POST', '/api/admin/password', { newPassword: 'first-password' }, H(tok));
    const noCur = await t.json('POST', '/api/admin/password', { newPassword: 'second-password' }, H(tok));
    assert.equal(noCur.status, 401);
    const ok = await t.json('POST', '/api/admin/password',
      { currentPassword: 'first-password', newPassword: 'second-password' }, H(tok));
    assert.equal(ok.status, 200);
  } finally { await t.close(); }
});

test('five wrong logins lock that IP for a minute', async () => {
  const t = await startServer();
  try {
    for (let i = 0; i < 5; i++) {
      assert.equal((await t.json('POST', '/api/admin/login', { password: 'nope' })).status, 401);
    }
    const locked = await t.json('POST', '/api/admin/login', { password: '1234' });
    assert.equal(locked.status, 429);
    assert.ok(locked.body.retryAfter > 0 && locked.body.retryAfter <= 60);
  } finally { await t.close(); }
});

test('lockout is per forwarded IP, not shared through nginx', async () => {
  const t = await startServer();
  try {
    const a = { 'X-Forwarded-For': '203.0.113.1' };
    const b = { 'X-Forwarded-For': '203.0.113.2' };
    for (let i = 0; i < 5; i++) await t.json('POST', '/api/admin/login', { password: 'nope' }, a);
    assert.equal((await t.json('POST', '/api/admin/login', { password: '1234' }, a)).status, 429);
    assert.equal((await t.json('POST', '/api/admin/login', { password: '1234' }, b)).status, 200);
  } finally { await t.close(); }
});

test('settings never expose password material', async () => {
  const t = await startServer({ settings: { adminPin: '9999' } });
  try {
    const r = await t.json('GET', '/api/settings');
    assert.equal(r.body.adminPin, undefined);
    assert.equal(r.body.adminPasswordHash, undefined);
    assert.equal(r.body.adminPasswordSalt, undefined);
  } finally { await t.close(); }
});

test('a leftover PIN session cannot take over once a password is set', async () => {
  const t = await startServer();
  try {
    const a = (await t.json('POST', '/api/admin/login', { password: '1234' })).body.token;
    const b = (await t.json('POST', '/api/admin/login', { password: '1234' })).body.token;
    assert.equal((await t.json('POST', '/api/admin/password', { newPassword: 'owner-password' }, H(a))).status, 200);

    const takeover = await t.json('POST', '/api/admin/password', { newPassword: 'attacker-password' }, H(b));
    assert.equal(takeover.status, 401);
    const revoked = await t.json('GET', '/api/archive', undefined, H(b));
    assert.equal(revoked.status, 401);
    assert.equal(revoked.body.error, 'admin_required');

    assert.equal((await t.json('GET', '/api/archive', undefined, H(a))).status, 200);
    const again = await t.json('POST', '/api/admin/login', { password: 'owner-password' });
    assert.equal(again.status, 200);
    assert.equal(again.body.mustChangePassword, false);
  } finally { await t.close(); }
});
