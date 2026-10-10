const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { isAllowedQlcExe, isQlc5, requireToken } = require('../show-player/bridge-guard');

test('QLC+ 5 is told apart from QLC+ 4', () => {
  assert.equal(isQlc5('C:\\QLC+5\\qlcplus5.exe'), true);
  assert.equal(isQlc5('C:\\QLC+\\qlcplus.exe'), false);
  assert.equal(isQlc5('/usr/bin/qlcplus'), false);
});

test('only existing qlcplus binaries are allowed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlc-'));
  const good = path.join(dir, 'qlcplus');
  const goodWin = path.join(dir, 'QLCPLUS.EXE');
  const good5 = path.join(dir, 'qlcplus5.exe');
  const bad = path.join(dir, 'cmd.exe');
  const lookalike = path.join(dir, 'qlcplus55.exe');
  for (const f of [good, goodWin, good5, bad, lookalike]) fs.writeFileSync(f, '');

  assert.equal(isAllowedQlcExe(good5), true);
  assert.equal(isAllowedQlcExe(lookalike), false);
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
