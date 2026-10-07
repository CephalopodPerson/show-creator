const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');
const { startServer, adminToken } = require('./helpers');

const C = code => ({ 'X-Show-Code': code });
const enc = encodeURIComponent;

async function create(t, name, editCode) {
  return t.json('POST', '/api/shows', editCode ? { name, editCode } : { name });
}

test('create returns the code once; reads never include it', async () => {
  const t = await startServer();
  try {
    const r = await create(t, 'Friday');
    assert.equal(r.status, 201);
    assert.match(r.body.editCode, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    assert.equal((await t.json('GET', '/api/shows/Friday')).body.editCode, undefined);
    assert.equal(JSON.stringify((await t.json('GET', '/api/shows')).body).includes(r.body.editCode), false);
  } finally { await t.close(); }
});

test('create validates name, code and uniqueness', async () => {
  const t = await startServer();
  try {
    assert.equal((await create(t, '<script>')).body.error, 'invalid_name');
    assert.equal((await create(t, 'Weak', '1234')).body.error, 'invalid_code');
    assert.equal((await create(t, 'Mine', 'Blue Moon')).status, 201);
    const dup = await create(t, 'Mine');
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'name_taken');
  } finally { await t.close(); }
});

test('every write route needs the right code', async () => {
  const t = await startServer();
  try {
    const code = (await create(t, 'Locked', 'Blue Moon')).body.editCode;
    const seq  = (await t.json('POST', '/api/shows/Locked/sequences', { name: 'S1' }, C(code))).body;

    const routes = [
      ['POST',   '/api/shows/Locked',                     { fixtureRoles: { par: 1 } }],
      ['POST',   '/api/shows/Locked/unlock',              {}],
      ['POST',   '/api/shows/Locked/sequences',           { name: 'S2' }],
      ['PUT',    `/api/shows/Locked/sequences/${seq.id}`, { name: 'S1b' }],
      ['PATCH',  '/api/shows/Locked/sequences/order',     { ids: [seq.id] }],
      ['DELETE', '/api/shows/Locked/uploads/none.mp3',    undefined],
      ['DELETE', `/api/shows/Locked/sequences/${seq.id}`, undefined],
    ];
    for (const [m, p, b] of routes) {
      assert.equal((await t.json(m, p, b)).body.error, 'code_required', `${m} ${p} without code`);
      assert.equal((await t.json(m, p, b, C('WRONG-1'))).body.error, 'code_wrong', `${m} ${p} wrong code`);
      const ok = await t.json(m, p, b, C('blue-moon'));
      assert.ok(![401, 403].includes(ok.status), `${m} ${p} right code → ${ok.status}`);
    }

    assert.equal((await t.json('POST', '/api/shows/Locked/archive')).status, 401);
    assert.equal((await t.json('POST', '/api/shows/Locked/archive', undefined, C(code))).status, 200);
  } finally { await t.close(); }
});

test('admin session bypasses show codes', async () => {
  const t = await startServer();
  try {
    await create(t, 'Theirs');
    const tok = await adminToken(t);
    const r = await t.json('POST', '/api/shows/Theirs/sequences', { name: 'x' }, { 'x-admin-token': tok });
    assert.equal(r.status, 200);
  } finally { await t.close(); }
});

test('reading and exporting need no code', async () => {
  const t = await startServer();
  try {
    await create(t, 'Open');
    assert.equal((await t.json('GET', '/api/shows/Open')).status, 200);
    assert.equal((await t.json('GET', '/api/shows/Open/sequences')).status, 200);
    assert.equal((await t.json('POST', '/api/shows/Open/export')).status, 400);   // no .qxw — but not 401
  } finally { await t.close(); }
});

test('copying a sequence needs the target code, not the source code', async () => {
  const t = await startServer();
  try {
    const a = (await create(t, 'Source')).body.editCode;
    const b = (await create(t, 'Target')).body.editCode;
    const seq = (await t.json('POST', '/api/shows/Source/sequences', { name: 'Song' }, C(a))).body;
    const p = `/api/shows/Source/sequences/${seq.id}/copy`;

    assert.equal((await t.json('POST', p, { targetShow: 'Target' })).body.error, 'code_required');
    assert.equal((await t.json('POST', p, { targetShow: 'Target' }, C(a))).body.error, 'code_required');
    const ok = await t.json('POST', p, { targetShow: 'Target' }, { 'X-Target-Show-Code': b });
    assert.equal(ok.status, 200);
    assert.equal((await t.json('POST', p, { targetShow: '..' }, { 'X-Target-Show-Code': b })).status, 400);
  } finally { await t.close(); }
});

test('server-owned fields cannot be set from a request body', async () => {
  const t = await startServer();
  try {
    const code = (await create(t, 'Guarded')).body.editCode;
    await t.json('POST', '/api/shows/Guarded',
      { qxwPath: '/etc/passwd', editCode: 'HIJACK', fixtureRoles: { par: 7 } }, C(code));
    const show = (await t.json('GET', '/api/shows/Guarded')).body;
    assert.equal(show.qxwPath, undefined);
    assert.deepEqual(show.fixtureRoles, { par: 7 });
    assert.equal((await t.json('POST', '/api/shows/Guarded/unlock', {}, C(code))).status, 200);
    assert.equal((await t.json('POST', '/api/shows/Guarded/unlock', {}, C('HIJACK'))).status, 403);

    const seq = (await t.json('POST', '/api/shows/Guarded/sequences',
      { name: 'S', qlcFunctionId: 999, id: 'chosen' }, C(code))).body;
    assert.notEqual(seq.id, 'chosen');
    assert.equal(seq.qlcFunctionId, undefined);
  } finally { await t.close(); }
});

test('rejected upload never touches disk', async () => {
  const t = await startServer();
  try {
    await create(t, 'NoUpload');
    const fd = new FormData();
    fd.append('audio', new Blob([Buffer.alloc(1024)]), 'song.mp3');
    const res = await fetch(`${t.base}/api/shows/NoUpload/audio`, { method: 'POST', body: fd });
    assert.equal(res.status, 401);
    assert.equal(fs.existsSync(path.join(t.root, 'shows', 'NoUpload', 'uploads', 'song.mp3')), false);
  } finally { await t.close(); }
});

test('suggest endpoint returns a fresh code', async () => {
  const t = await startServer();
  try {
    const r = await t.json('GET', '/api/codes/suggest');
    assert.match(r.body.code, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  } finally { await t.close(); }
});
