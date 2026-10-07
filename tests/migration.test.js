const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');
const { startServer, adminToken } = require('./helpers');

function writeLegacyShow(root, name) {
  const dir = path.join(root, 'shows', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'show.json'), JSON.stringify({ name, sequences: [] }));
  return path.join(dir, 'show.json');
}

test('assignMissingCodes gives legacy shows a code exactly once', async () => {
  const t = await startServer();
  try {
    const file = writeLegacyShow(t.root, 'Old Show');
    assert.equal(t.mod.assignMissingCodes(), 1);
    const first = JSON.parse(fs.readFileSync(file, 'utf8')).editCode;
    assert.match(first, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    assert.equal(t.mod.assignMissingCodes(), 0);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).editCode, first);
  } finally { await t.close(); }
});

test('admin can list and change codes; old code stops working after change', async () => {
  const t = await startServer();
  try {
    const old = (await t.json('POST', '/api/shows', { name: 'Show A' })).body.editCode;
    const tok = await adminToken(t);
    const H = { 'x-admin-token': tok };

    assert.equal((await t.json('GET', '/api/admin/codes')).status, 401);
    const list = await t.json('GET', '/api/admin/codes', undefined, H);
    assert.deepEqual(list.body, [{ name: 'Show A', editCode: old }]);

    assert.equal((await t.json('PUT', '/api/admin/codes/Show%20A', { editCode: '0000' }, H)).status, 400);
    assert.equal((await t.json('PUT', '/api/admin/codes/Missing', { editCode: 'New Code 9' }, H)).status, 404);
    assert.equal((await t.json('PUT', '/api/admin/codes/Show%20A', { editCode: 'New Code 9' }, H)).status, 200);

    assert.equal((await t.json('POST', '/api/shows/Show%20A/unlock', {}, { 'X-Show-Code': old })).status, 403);
    assert.equal((await t.json('POST', '/api/shows/Show%20A/unlock', {}, { 'X-Show-Code': 'new code 9' })).status, 200);
  } finally { await t.close(); }
});

test('restore keeps or assigns a code; archive copy gets a fresh one', async () => {
  const t = await startServer();
  try {
    const tok = await adminToken(t);
    const H = { 'x-admin-token': tok };

    // Archived before this change: no code on disk.
    const dir = path.join(t.root, 'archive', 'Archived');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'show.json'), JSON.stringify({ name: 'Archived', sequences: [] }));

    assert.equal((await t.json('POST', '/api/archive/Archived/copy', { name: 'Copied' }, H)).status, 200);
    assert.equal((await t.json('POST', '/api/archive/Archived/restore', undefined, H)).status, 200);

    const codes = Object.fromEntries((await t.json('GET', '/api/admin/codes', undefined, H)).body.map(r => [r.name, r.editCode]));
    assert.ok(codes.Archived);
    assert.ok(codes.Copied);
    assert.notEqual(codes.Archived, codes.Copied);
  } finally { await t.close(); }
});
