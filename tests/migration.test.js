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

test('a broken show does not stop the others getting codes', async () => {
  const t = await startServer();
  try {
    const garbled = path.join(t.root, 'shows', 'Garbled');
    fs.mkdirSync(garbled, { recursive: true });
    fs.writeFileSync(path.join(garbled, 'show.json'), '{ not json');
    const files = ['Alpha', 'Beta', 'Gamma'].map(n => writeLegacyShow(t.root, n));
    assert.equal(t.mod.assignMissingCodes(), 3);
    for (const f of files) assert.ok(JSON.parse(fs.readFileSync(f, 'utf8')).editCode, f);
  } finally { await t.close(); }
});

test('a show that cannot be written is logged and skipped', { skip: process.getuid?.() === 0 }, async () => {
  const t = await startServer();
  const stuck = path.join(t.root, 'shows', 'Stuck');
  const logged = [];
  const origError = console.error;
  try {
    const stuckFile = writeLegacyShow(t.root, 'Stuck');
    const files = ['Alpha', 'Omega'].map(n => writeLegacyShow(t.root, n));
    fs.chmodSync(stuckFile, 0o444);
    fs.chmodSync(stuck, 0o555);
    console.error = (...a) => logged.push(a.join(' '));

    assert.equal(t.mod.assignMissingCodes(), 2);
    for (const f of files) assert.ok(JSON.parse(fs.readFileSync(f, 'utf8')).editCode, f);
    assert.ok(logged.some(l => l.startsWith('Could not assign code to "Stuck": ')), logged.join('\n'));
    assert.equal(JSON.parse(fs.readFileSync(stuckFile, 'utf8')).editCode, undefined);
  } finally {
    console.error = origError;
    fs.chmodSync(stuck, 0o755);
    await t.close();
  }
});

test('saving a show leaves no temp file behind', async () => {
  const t = await startServer();
  try {
    const code = (await t.json('POST', '/api/shows', { name: 'Atomic' })).body.editCode;
    await t.json('POST', '/api/shows/Atomic/sequences', { name: 'S' }, { 'X-Show-Code': code });
    const dir = path.join(t.root, 'shows', 'Atomic');
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'show.json'), 'utf8')).sequences.length, 1);
  } finally { await t.close(); }
});

test('archiving never overwrites an archived show of the same name', async () => {
  const t = await startServer();
  try {
    const tok = await adminToken(t);
    const H = { 'x-admin-token': tok };
    const first = (await t.json('POST', '/api/shows', { name: 'Gala' })).body.editCode;
    await t.json('POST', '/api/shows/Gala/sequences', { name: 'Original' }, { 'X-Show-Code': first });
    assert.equal((await t.json('POST', '/api/shows/Gala/archive', undefined, { 'X-Show-Code': first })).status, 200);

    const second = (await t.json('POST', '/api/shows', { name: 'Gala' })).body.editCode;
    const r = await t.json('POST', '/api/shows/Gala/archive', undefined, { 'X-Show-Code': second });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.match(r.body.archivedAs, /^Gala \(archived \d{4}-\d{2}-\d{2} \d{4}\)$/);

    const third = (await t.json('POST', '/api/shows', { name: 'Gala' })).body.editCode;
    const r3 = await t.json('POST', '/api/shows/Gala/archive', undefined, { 'X-Show-Code': third });
    assert.equal(r3.status, 200);
    assert.notEqual(r3.body.archivedAs, r.body.archivedAs);

    const archive = (await t.json('GET', '/api/archive', undefined, H)).body;
    const byName = Object.fromEntries(archive.map(a => [a.name, a]));
    assert.equal(byName.Gala?.sequences, 1, 'original archived show kept');
    assert.ok(byName[r.body.archivedAs], 'second archived under the suffixed name');
    assert.ok(byName[r3.body.archivedAs], 'third archived under its own name');
    assert.equal(archive.length, 3);
  } finally { await t.close(); }
});
