const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { isAllowedQlcExe, requireToken } = require('../show-player/bridge-guard');

test('only existing qlcplus binaries are allowed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlc-'));
  const good = path.join(dir, 'qlcplus');
  const goodWin = path.join(dir, 'QLCPLUS.EXE');
  const bad = path.join(dir, 'cmd.exe');
  for (const f of [good, goodWin, bad]) fs.writeFileSync(f, '');

  assert.equal(isAllowedQlcExe(good), true);
  assert.equal(isAllowedQlcExe(goodWin), true);
  assert.equal(isAllowedQlcExe(bad), false);
  assert.equal(isAllowedQlcExe(path.join(dir, 'missing', 'qlcplus')), false);
  assert.equal(isAllowedQlcExe(dir), false);              // a directory, not a file
  assert.equal(isAllowedQlcExe('C:\\Windows\\System32\\cmd.exe'), false);
  assert.equal(isAllowedQlcExe(''), false);
  assert.equal(isAllowedQlcExe(undefined), false);
});

test('requireToken rejects missing or wrong tokens', () => {
  const mw = requireToken('secret');
  const run = (method, token) => {
    let status = 200, nexted = false;
    const req = { method, get: h => (h.toLowerCase() === 'x-bridge-token' ? token : undefined) };
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    mw(req, res, () => { nexted = true; });
    return nexted ? 'next' : status;
  };
  assert.equal(run('POST', 'secret'), 'next');
  assert.equal(run('POST', 'nope'), 403);
  assert.equal(run('POST', undefined), 403);
  assert.equal(run('OPTIONS', undefined), 'next');
  assert.equal(requireToken('')({ method: 'GET', get: () => '' }, { status() { return this; }, json() { return 'blocked'; } }, () => 'next'), 'blocked');
});
