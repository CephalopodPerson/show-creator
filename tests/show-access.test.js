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

test('static /shows mount only serves uploads, never show.json or the edit code', async () => {
  const t = await startServer();
  try {
    const r = await create(t, 'StaticGuard', 'Blue Moon');
    const code = r.body.editCode;

    const hidden = await t.json('GET', `/shows/${enc('StaticGuard')}/show.json`);
    assert.equal(hidden.status, 404);
    assert.equal(JSON.stringify(hidden.body).includes(code), false);

    const fd = new FormData();
    fd.append('audio', new Blob([Buffer.alloc(600000)]), 'track.mp3');
    const upload = await fetch(`${t.base}/api/shows/${enc('StaticGuard')}/audio`, {
      method: 'POST',
      headers: C(code),
      body: fd,
    });
    assert.equal(upload.status, 200);

    const served = await fetch(`${t.base}/shows/${enc('StaticGuard')}/uploads/track.mp3`);
    assert.equal(served.status, 200);
  } finally { await t.close(); }
});

test('admin writes to a nonexistent show 404 instead of touching the filesystem', async () => {
  const t = await startServer();
  try {
    const tok = await adminToken(t);

    const r = await t.json('POST', '/api/shows/Ghost/sequences', { name: 'x' }, { 'x-admin-token': tok });
    assert.equal(r.status, 404);

    const fd = new FormData();
    fd.append('audio', new Blob([Buffer.alloc(600000)]), 'track.mp3');
    const res = await fetch(`${t.base}/api/shows/Ghost/audio`, {
      method: 'POST',
      headers: { 'x-admin-token': tok },
      body: fd,
    });
    assert.equal(res.status, 404);
    assert.equal(fs.existsSync(path.join(t.root, 'shows', 'Ghost')), false);
  } finally { await t.close(); }
});

test('ten wrong codes lock that IP out of code checks for a minute', async () => {
  const t = await startServer();
  try {
    await create(t, 'Guessable', 'Blue Moon');
    const ip = { 'X-Forwarded-For': '203.0.113.10' };
    for (let i = 0; i < 10; i++) {
      const r = await t.json('POST', '/api/shows/Guessable/unlock', {}, { ...ip, ...C(`WRONG-${i}`) });
      assert.equal(r.status, 403, `attempt ${i + 1}`);
    }
    const locked = await t.json('POST', '/api/shows/Guessable/unlock', {}, { ...ip, ...C('Blue Moon') });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error, 'locked');
    assert.ok(locked.body.retryAfter >= 1 && locked.body.retryAfter <= 60, `retryAfter ${locked.body.retryAfter}`);

    const other = { 'X-Forwarded-For': '203.0.113.11' };
    assert.equal((await t.json('POST', '/api/shows/Guessable/unlock', {}, { ...other, ...C('Blue Moon') })).status, 200);
  } finally { await t.close(); }
});

test('a correct code resets the wrong-code count; missing codes do not count', async () => {
  const t = await startServer();
  try {
    await create(t, 'Resettable', 'Blue Moon');
    const ip = { 'X-Forwarded-For': '203.0.113.20' };
    const unlock = code => t.json('POST', '/api/shows/Resettable/unlock', {}, code ? { ...ip, ...C(code) } : ip);
    for (let i = 0; i < 9; i++) assert.equal((await unlock(`WRONG-${i}`)).status, 403);
    for (let i = 0; i < 5; i++) assert.equal((await unlock()).status, 401);
    assert.equal((await unlock('Blue Moon')).status, 200);
    for (let i = 0; i < 9; i++) assert.equal((await unlock(`WRONG-${i}`)).status, 403);
    assert.equal((await unlock('Blue Moon')).status, 200);
  } finally { await t.close(); }
});

test('fixtureRoles must be a plain object', async () => {
  const t = await startServer();
  try {
    const code = (await create(t, 'Roles')).body.editCode;
    for (const bad of [null, ['par'], 'par', 7]) {
      const r = await t.json('POST', '/api/shows/Roles', { fixtureRoles: bad }, C(code));
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.body.error, 'invalid_fixture_roles');
    }
    assert.equal((await t.json('POST', '/api/shows/Roles', { fixtureRoles: { par: 2 } }, C(code))).status, 200);
    assert.deepEqual((await t.json('GET', '/api/shows/Roles')).body.fixtureRoles, { par: 2 });
  } finally { await t.close(); }
});

test('static guard blocks traversal and encoded paths to show.json', async () => {
  const t = await startServer();
  try {
    const code = (await create(t, 'Vault', 'Blue Moon')).body.editCode;
    const paths = [
      '/shows/Vault/uploads/../show.json',
      '/shows/Vault%2Fuploads%2F..%2Fshow.json',
      '/shows/%2e%2e/Vault/show.json',
      '/shows/Vault/show.json',
    ];
    for (const p of paths) {
      const r = await t.raw('GET', p);
      assert.notEqual(r.status, 200, p);
      assert.equal(JSON.stringify(r.body).includes(code), false, `${p} leaked the code`);
      assert.equal(JSON.stringify(r.body).includes('Blue Moon'), false, `${p} leaked the code`);
    }
  } finally { await t.close(); }
});
