# Show Codes & Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every change to a show requires that show's edit code (or an admin session), the admin PIN becomes a hashed password, and the review's security holes (path traversal, open bridge, Show Player injection, open UDP relay) are closed.

**Architecture:** The Express app moves from `server/index.js` into `server/app.js` (exported, testable); `index.js` only migrates and listens. New single-purpose modules in `server/lib/` hold name rules, code rules, password hashing, admin sessions/lockout, and the show-access middleware. The React client gets one `writeShow()` helper that attaches the stored code, and a single prompt host that asks for a code when the server says it's needed.

**Tech Stack:** Node 22, Express 4, multer, React 18 + Vite 5, Electron (Show Player). Tests: Node's built-in `node:test` + global `fetch` — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-show-codes-security-design.md`

## Global Constraints

- No new npm dependencies (server, client, or show-player). Use `node:crypto`, `node:test`, `node:http`, global `fetch`.
- Branch: `feat/show-codes`. Do **not** commit `client/dist/` changes — the VPS rebuilds the client on deploy (`deploy/update.sh`).
- `server/index.js` must always call `listen()` — PM2 and the Electron wrapper (`main.js`) both `require` it.
- Show code header: `X-Show-Code`. Copy-target header: `X-Target-Show-Code`. Admin header stays `x-admin-token`.
- Auth error bodies are exactly `{ error: 'code_required' }` (401) and `{ error: 'code_wrong' }` (403); client logic keys off these strings.
- Suggested codes: 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, formatted `XXX-XXX`.
- Custom codes: 4–32 chars, printable ASCII, not all one character, not a straight run.
- New show names: 1–60 chars of letters (any language), digits, spaces, `- _ , ' ( ) & !`. Every route: reject empty, leading `.`, `/`, `\`, control chars.
- Admin password: ≥ 8 chars, scrypt-hashed. 5 failed logins per IP → 60 s lockout (`429 { error: 'locked', retryAfter }`).
- `editCode` never appears in a non-admin response except the `201` from show creation.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Stale code in the browser after an admin changes it** — the next save gets `code_wrong`; the user must see the prompt (not a silent failure), and entering the new code must retry and succeed. Pinned by the Task 5 test "old code stops working after change" (server side) and Task 8's manual check.
2. **Several writes failing at once** (auto-save fires while an upload is in flight) — the user must see **one** prompt per show, not a stack of them. Pinned by `requestCode` de-duplication in Task 7 and Task 8's manual check.
3. **All visitors share nginx's IP** — one person's wrong passwords must not lock out everyone. Pinned by the Task 4 test "lockout is per forwarded IP".
4. **Non-ASCII code** (e.g. `café1`) — `fetch` throws when a header contains it, which would look like a network failure. Rejected at creation; pinned by the Task 3 test for `checkCustomCode('café1')`.
5. **Upload without a code** — multer writes to disk before handlers run; a rejected upload must leave nothing behind. Pinned by the Task 5 test "rejected upload never touches disk".

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `server/app.js` | from `server/index.js` (git mv) | Builds and exports the Express app + `assignMissingCodes()` |
| `server/index.js` | rewrite (3 lines of logic) | Migrate codes, `listen()` |
| `server/lib/names.js` | new | Show-name safety + naming rules, `resolveInside()` |
| `server/lib/codes.js` | new | Generate / normalize / validate / compare edit codes |
| `server/lib/password.js` | new | scrypt hash + verify |
| `server/lib/adminAuth.js` | new | Admin sessions, login (legacy PIN migration), lockout, password change |
| `server/lib/showAccess.js` | new | `requireShowCode`, `requireTargetCode` middleware; `publicShow()` |
| `tests/helpers.js` | new | Start app on a temp dir, HTTP helpers |
| `tests/*.test.js` | new | One file per task |
| `client/src/lib/showCodes.js` | new | Code store, `writeShow()`, prompt bridge |
| `client/src/components/CodePrompt.jsx` | new | The "this show is locked" modal host |
| `client/src/App.jsx`, `ShowList.jsx`, `ShowEditor.jsx`, `StorageManager.jsx`, `AdminPanel.jsx`, `styles.css` | modify | Wire codes into the UI |
| `show-player/bridge-guard.js` | new | `isAllowedQlcExe()`, `requireToken()` |
| `show-player/server.js`, `main.js`, `app.html` | modify | Token, exe check, safe rendering, drop `/ledfx` |

---

### Task 0: Tooling prerequisites (human step)

Node.js is not installed on this machine, and installing it needs `sudo`.

- [ ] **Step 1: Ask the user to install Node.js and npm**

The user runs (needs their password):

```bash
sudo apt install nodejs npm
```

- [ ] **Step 2: Verify and install project dependencies**

Run: `node --version && npm --version && cd /home/rob/show-creator && npm install && npm install --prefix client`
Expected: Node `v22.x`; both installs finish without errors.

- [ ] **Step 3: Verify the client builds before any changes**

Run: `cd /home/rob/show-creator && npm run build --prefix client`
Expected: `✓ built in …`. Then `git checkout -- client/dist` to discard the rebuilt bundle (never commit it).

---

### Task 1: Split server into app + entry point; test harness; remove OSC relay

**Files:**
- Move: `server/index.js` → `server/app.js`
- Create: `server/index.js`, `tests/helpers.js`, `tests/app.test.js`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `require('./server/app')` → `{ app }` (Task 6 adds `assignMissingCodes`). `tests/helpers.js` → `startServer({ settings? })` returning `{ base, root, mod, close(), json(method, path, body?, headers?), raw(method, path, headers?) }`, each HTTP helper resolving to `{ status, body }` (body parsed as JSON when possible).
- Env read by `app.js`: `SHOWS_DIR`, `ARCHIVE_DIR`, `DATA_DIR` (new; default `<repo>/data`), `CHANNEL`, `OTHER_CHANNEL_URL`, `CLIENT_DIST`, `NODE_ENV`, `ADMIN_PIN`.

- [ ] **Step 1: Write the harness and failing smoke test**

`tests/helpers.js`:

```js
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SERVER_DIR = path.resolve(__dirname, '..', 'server');

function parse(text) {
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Boot a fresh copy of the app on a random port with its own temp data dirs.
 * `settings` (optional) is written to settings.json before the app loads.
 */
async function startServer({ settings } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test-'));
  process.env.SHOWS_DIR   = path.join(root, 'shows');
  process.env.ARCHIVE_DIR = path.join(root, 'archive');
  process.env.DATA_DIR    = path.join(root, 'data');
  delete process.env.ADMIN_PIN;
  delete process.env.NODE_ENV;

  if (settings) {
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.DATA_DIR, 'settings.json'), JSON.stringify(settings));
  }

  // Fresh module state (sessions, caches, lockouts) for every server.
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SERVER_DIR)) delete require.cache[key];
  }
  const mod = require(path.join(SERVER_DIR, 'app.js'));

  const server = await new Promise(resolve => {
    const s = mod.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  async function json(method, p, body, headers = {}) {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: parse(await res.text()) };
  }

  // fetch() normalizes "..", so traversal tests need a raw request.
  function raw(method, p, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  return {
    base, root, mod, json, raw,
    close: () => new Promise(r => server.close(r)),
  };
}

module.exports = { startServer };
```

`tests/app.test.js`:

```js
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
```

Add to `package.json` `"scripts"`:

```json
"test": "node --test tests/*.test.js",
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '…/server/app.js'`.

- [ ] **Step 3: Move and split**

```bash
git mv server/index.js server/app.js
```

In `server/app.js`:

1. Delete `const dgram = require('dgram');` and `const PORT = process.env.PORT || 3000;`.
2. Replace `const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');` with:

```js
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
```

3. In `templateUpload`'s `destination`, replace `const dir = path.join(__dirname, '..', 'data');` with `const dir = DATA_DIR;`.
4. Delete the whole `// ── OSC trigger ──` section: `sendOsc`, `oscString`, and `app.post('/api/osc', …)`.
5. Delete the unused `dirSize` function.
6. Replace the last line (`app.listen(PORT, …)`) with:

```js
module.exports = { app };
```

New `server/index.js`:

```js
const { app } = require('./app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Show Creator running at http://localhost:${PORT}`));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add package.json server/app.js server/index.js tests/
git commit -m "refactor: split server into app.js + entry point, add test harness, drop OSC relay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Show-name safety rule on every route

**Files:**
- Create: `server/lib/names.js`, `tests/names.test.js`
- Modify: `server/app.js`

**Interfaces:**
- Produces (`server/lib/names.js`):
  - `isSafeName(name: string): boolean`
  - `checkNewName(raw: unknown): { ok: true, name: string } | { ok: false, message: string }`
  - `resolveInside(dir: string, name: string): string` — throws `Error('Path escapes base dir')`.
- `app.js` gains `archivePath(name)`; `showPath(name)` now uses `resolveInside`.

- [ ] **Step 1: Write failing tests**

`tests/names.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../server/lib/names'`.

- [ ] **Step 3: Implement `server/lib/names.js`**

```js
const path = require('path');

// Anything that could steer a filesystem path somewhere else.
const UNSAFE = /[/\\\u0000-\u001f\u007f]/;

/** Applied to every route: blocks traversal, keeps old show names working. */
function isSafeName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 200
    && !name.startsWith('.')
    && !UNSAFE.test(name);
}

const NEW_NAME = /^[\p{L}\p{N} _\-,'()&!]+$/u;

/** Applied only when a show is created: a readable, predictable name. */
function checkNewName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, message: 'Give the show a name.' };
  if (name.length > 60) return { ok: false, message: 'Show names can be at most 60 characters.' };
  if (!isSafeName(name) || !NEW_NAME.test(name)) {
    return { ok: false, message: "Use letters, numbers, spaces and - _ , ' ( ) & ! only." };
  }
  return { ok: true, name };
}

/** Join and verify the result is a direct child of dir — last line of defence. */
function resolveInside(dir, name) {
  const base = path.resolve(dir);
  const full = path.resolve(base, name);
  if (path.dirname(full) !== base) throw new Error('Path escapes base dir');
  return full;
}

module.exports = { isSafeName, checkNewName, resolveInside };
```

- [ ] **Step 4: Wire into `server/app.js`**

Add near the other requires:

```js
const { isSafeName, checkNewName, resolveInside } = require('./lib/names');
```

Immediately after `app.use(express.json());` add:

```js
// Every route with :showName gets the safety rule before any handler —
// including multer, whose upload destination is built from this param.
app.param('showName', (req, res, next, name) => {
  if (!isSafeName(name)) {
    return res.status(400).json({ error: 'invalid_name', message: 'That show name is not allowed.' });
  }
  next();
});
```

Replace the `showPath` helper and add `archivePath` beside it:

```js
function showPath(name)    { return resolveInside(SHOWS_DIR, name); }
function archivePath(name) { return resolveInside(ARCHIVE_DIR, name); }
```

Replace every `path.join(ARCHIVE_DIR, showName)` and `path.join(ARCHIVE_DIR, name, 'show.json')` with `archivePath(showName)` / `path.join(archivePath(name), 'show.json')` (archive route, archive list, restore, hard-delete, copy). In the multer `destination`, replace `path.join(SHOWS_DIR, req.params.showName, 'uploads')` with `path.join(showPath(req.params.showName), 'uploads')`. In the uploads-delete route, replace `path.join(SHOWS_DIR, showName, 'uploads', safe)` with `path.join(showPath(showName), 'uploads', safe)`.

In `GET /api/shows` and `GET /api/storage`, skip unsafe directory names: change `.filter(d => fs.statSync(path.join(SHOWS_DIR, d)).isDirectory())` to `.filter(d => isSafeName(d) && fs.statSync(path.join(SHOWS_DIR, d)).isDirectory())`. Same for `GET /api/archive` with `ARCHIVE_DIR`.

In archive copy, replace `const newName = req.body.name || showName + ' (copy)';` with:

```js
  const check = checkNewName(req.body?.name || `${showName} (copy)`);
  if (!check.ok) return res.status(400).json({ error: 'invalid_name', message: check.message });
  const newName = check.name;
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add server/lib/names.js server/app.js tests/names.test.js
git commit -m "fix: reject unsafe show names on every route (path traversal)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Edit-code rules

**Files:**
- Create: `server/lib/codes.js`, `tests/codes.test.js`

**Interfaces:**
- Produces (`server/lib/codes.js`):
  - `generateCode(): string` — e.g. `'K7M-4QX'`
  - `normalizeCode(code: unknown): string` — strips spaces/dashes, uppercases
  - `checkCustomCode(raw: unknown): { ok: true, code: string } | { ok: false, message: string }`
  - `codesMatch(stored: unknown, given: unknown): boolean` — false if either normalizes to empty

- [ ] **Step 1: Write failing tests**

`tests/codes.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../server/lib/codes'`.

- [ ] **Step 3: Implement `server/lib/codes.js`**

```js
const crypto = require('crypto');

// No 0/O or 1/I/L — codes get read aloud and copied off paper.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

function normalizeCode(code) {
  return String(code ?? '').replace(/[\s-]+/g, '').toUpperCase();
}

// 1234, 4321, ABCD — each character one step from the last.
function isStraightRun(s) {
  if (s.length < 2) return false;
  const step = s.charCodeAt(1) - s.charCodeAt(0);
  if (Math.abs(step) !== 1) return false;
  for (let i = 2; i < s.length; i++) {
    if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false;
  }
  return true;
}

function checkCustomCode(raw) {
  const code = String(raw ?? '').trim();
  const n = normalizeCode(code);
  if (n.length < 4) return { ok: false, message: 'Codes need at least 4 characters.' };
  if (code.length > 32) return { ok: false, message: 'Codes can be at most 32 characters.' };
  // Codes travel in an HTTP header, which only carries plain ASCII.
  if (!/^[\x20-\x7e]+$/.test(code)) {
    return { ok: false, message: 'Use letters, numbers and symbols from a standard keyboard.' };
  }
  if (/^(.)\1+$/.test(n) || isStraightRun(n)) {
    return { ok: false, message: 'That code is too easy to guess.' };
  }
  return { ok: true, code };
}

function codesMatch(stored, given) {
  const a = Buffer.from(normalizeCode(stored));
  const b = Buffer.from(normalizeCode(given));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { generateCode, normalizeCode, checkCustomCode, codesMatch };
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/lib/codes.js tests/codes.test.js
git commit -m "feat: edit-code generation and validation rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Admin password, lockout, legacy PIN migration

**Files:**
- Create: `server/lib/password.js`, `server/lib/adminAuth.js`, `tests/admin.test.js`
- Modify: `server/app.js`, `tests/helpers.js`

**Interfaces:**
- Produces:
  - `hashPassword(pw: string): { salt: string, hash: string }`, `verifyPassword(pw, salt, hash): boolean`
  - `createAdminAuth({ loadSettings, saveSettings })` → `{ isAdmin(req): boolean, requireAdmin, login, changePassword }`
  - Routes: `POST /api/admin/login` `{ password }` → `{ token, mustChangePassword }` | 401 `wrong_password` | 429 `{ error: 'locked', retryAfter }`; `POST /api/admin/password` `{ currentPassword?, newPassword }` → `{ ok: true }` | 400 `weak_password` | 401. `POST /api/admin/pin` is removed.
  - `requireAdmin` → 401 `{ error: 'admin_required' }` or 403 `{ error: 'password_change_required' }`.
  - `tests/helpers.js` gains `adminToken(t): Promise<string>` (logs in with `1234`, sets password `test-password-1`).

- [ ] **Step 1: Write failing tests**

Append to `tests/helpers.js` (before `module.exports`) and export it:

```js
/** Log in on a fresh server and complete the forced password change. */
async function adminToken(t) {
  const login = await t.json('POST', '/api/admin/login', { password: '1234' });
  const token = login.body.token;
  await t.json('POST', '/api/admin/password', { newPassword: 'test-password-1' }, { 'x-admin-token': token });
  return token;
}

module.exports = { startServer, adminToken };
```

(Replace the previous `module.exports = { startServer };` line.)

`tests/admin.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `mustChangePassword` undefined (current login reads `req.body.pin`).

- [ ] **Step 3: Implement `server/lib/password.js`**

```js
const crypto = require('crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const actual   = crypto.scryptSync(String(pw), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
```

- [ ] **Step 4: Implement `server/lib/adminAuth.js`**

```js
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./password');

const SESSION_MS   = 4 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS      = 60 * 1000;
const MIN_PASSWORD = 8;

function createAdminAuth({ loadSettings, saveSettings }) {
  const sessions = new Map();   // token → { exp, mustChange }
  const failures = new Map();   // ip → { count, until }

  function purgeExpired() {
    const now = Date.now();
    for (const [token, s] of sessions) if (s.exp < now) sessions.delete(token);
  }

  function sessionFor(req) {
    const token = req.headers['x-admin-token'];
    const s = token && sessions.get(token);
    if (!s || Date.now() > s.exp) return null;
    s.exp = Date.now() + SESSION_MS;   // sliding expiry
    return s;
  }

  // Before a password is set, the old PIN (settings → env → '1234') is accepted
  // and flagged so the session can do nothing but set a real password.
  function checkPassword(pw) {
    const s = loadSettings();
    if (s.adminPasswordHash) {
      return { ok: verifyPassword(pw, s.adminPasswordSalt, s.adminPasswordHash), legacy: false };
    }
    const legacy = s.adminPin || process.env.ADMIN_PIN || '1234';
    return { ok: String(pw) === String(legacy), legacy: true };
  }

  function isAdmin(req) {
    const s = sessionFor(req);
    return !!s && !s.mustChange;
  }

  function requireAdmin(req, res, next) {
    const s = sessionFor(req);
    if (!s) return res.status(401).json({ error: 'admin_required' });
    if (s.mustChange) return res.status(403).json({ error: 'password_change_required' });
    next();
  }

  function login(req, res) {
    const ip  = req.ip;
    const now = Date.now();
    let f = failures.get(ip);
    if (f?.until && f.until <= now) { failures.delete(ip); f = undefined; }
    if (f?.until) {
      return res.status(429).json({ error: 'locked', retryAfter: Math.ceil((f.until - now) / 1000) });
    }

    const { ok, legacy } = checkPassword(req.body?.password ?? '');
    if (!ok) {
      const count = (f?.count ?? 0) + 1;
      failures.set(ip, { count, until: count >= MAX_FAILURES ? now + LOCK_MS : 0 });
      return res.status(401).json({ error: 'wrong_password' });
    }

    failures.delete(ip);
    purgeExpired();
    const token = crypto.randomUUID();
    sessions.set(token, { exp: now + SESSION_MS, mustChange: legacy });
    res.json({ token, mustChangePassword: legacy });
  }

  function changePassword(req, res) {
    const s = sessionFor(req);
    if (!s) return res.status(401).json({ error: 'admin_required' });

    const { currentPassword, newPassword } = req.body ?? {};
    if (!s.mustChange && !checkPassword(currentPassword ?? '').ok) {
      return res.status(401).json({ error: 'wrong_password', message: 'Current password is incorrect.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
      return res.status(400).json({ error: 'weak_password', message: `Use at least ${MIN_PASSWORD} characters.` });
    }

    const settings = loadSettings();
    const { salt, hash } = hashPassword(newPassword);
    settings.adminPasswordSalt = salt;
    settings.adminPasswordHash = hash;
    delete settings.adminPin;
    saveSettings(settings);
    s.mustChange = false;
    res.json({ ok: true });
  }

  return { isAdmin, requireAdmin, login, changePassword };
}

module.exports = { createAdminAuth };
```

- [ ] **Step 5: Wire into `server/app.js`**

1. Add `const { createAdminAuth } = require('./lib/adminAuth');` with the other requires.
2. Delete `const ADMIN_PIN = …`, `const adminSessions = new Map();`, the `adminPin: null` line in `DEFAULT_SETTINGS`, `currentPin()`, the `requireAdmin` function, the `/api/admin/login` route and the `/api/admin/pin` route.
3. Right after `app.use(express.json());` add:

```js
// Behind nginx every request arrives from 127.0.0.1; trust its
// X-Forwarded-For so login lockouts are per visitor, not global.
app.set('trust proxy', 'loopback');
```

4. Right after `saveSettings` is defined add:

```js
const auth = createAdminAuth({ loadSettings, saveSettings });
const { requireAdmin } = auth;

const SECRET_SETTINGS = ['adminPin', 'adminPasswordHash', 'adminPasswordSalt'];
function publicSettings(s) {
  const out = { ...s };
  for (const k of SECRET_SETTINGS) delete out[k];
  return out;
}
```

5. Replace the two settings routes and add the admin routes:

```js
app.get('/api/settings', (req, res) => {
  res.json(publicSettings(loadSettings()));
});
app.put('/api/settings', requireAdmin, (req, res) => {
  const s = { ...loadSettings(), ...publicSettings(req.body ?? {}) };
  saveSettings(s);
  res.json(publicSettings(s));
});

app.post('/api/admin/login',    auth.login);
app.post('/api/admin/password', auth.changePassword);
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add server/lib/password.js server/lib/adminAuth.js server/app.js tests/admin.test.js tests/helpers.js
git commit -m "feat: hashed admin password with lockout and one-time PIN migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Show codes on every write route

**Files:**
- Create: `server/lib/showAccess.js`, `tests/show-access.test.js`
- Modify: `server/app.js`

**Interfaces:**
- Consumes: `codesMatch`, `generateCode`, `checkCustomCode` (Task 3); `checkNewName`, `isSafeName` (Task 2); `auth.isAdmin` (Task 4).
- Produces:
  - `createShowAccess({ loadShow, isAdmin })` → `{ requireShowCode, requireTargetCode }`; `publicShow(show)` strips `editCode`.
  - `POST /api/shows` `{ name, editCode? }` → `201 { ...show, editCode }` | 400 `invalid_name`/`invalid_code` | 409 `name_taken`.
  - `POST /api/shows/:showName/unlock` → `{ ok: true }` (code-protected).
  - `GET /api/codes/suggest` → `{ code }`.
  - Sequence write bodies are filtered to `SEQ_FIELDS = ['name','steps','audioPath','audioDuration','bpm','bpmConfidence']`.

- [ ] **Step 1: Write failing tests**

`tests/show-access.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `POST /api/shows` returns 404.

- [ ] **Step 3: Implement `server/lib/showAccess.js`**

```js
const { codesMatch } = require('./codes');
const { isSafeName } = require('./names');

/** A show as the public API may see it — never the edit code. */
function publicShow(show) {
  if (!show) return show;
  const { editCode, ...rest } = show;
  return rest;
}

// One place decides write access. Google sign-in later becomes another
// "allow" branch here; no route needs to change.
function createShowAccess({ loadShow, isAdmin }) {
  function check(req, showName, header) {
    if (isAdmin(req)) return null;
    const show = loadShow(showName);
    if (!show) return [404, { error: 'Show not found' }];
    const given = req.get(header);
    if (!given) return [401, { error: 'code_required', show: showName }];
    if (!codesMatch(show.editCode, given)) return [403, { error: 'code_wrong', show: showName }];
    return null;
  }

  function requireShowCode(req, res, next) {
    const fail = check(req, req.params.showName, 'x-show-code');
    if (fail) return res.status(fail[0]).json(fail[1]);
    next();
  }

  function requireTargetCode(req, res, next) {
    const target = req.body?.targetShow;
    if (typeof target !== 'string' || !isSafeName(target)) {
      return res.status(400).json({ error: 'targetShow required' });
    }
    const fail = check(req, target, 'x-target-show-code');
    if (fail) return res.status(fail[0]).json(fail[1]);
    next();
  }

  return { requireShowCode, requireTargetCode };
}

module.exports = { createShowAccess, publicShow };
```

- [ ] **Step 4: Wire into `server/app.js` — setup**

Add requires:

```js
const { createShowAccess, publicShow } = require('./lib/showAccess');
const { generateCode, checkCustomCode } = require('./lib/codes');
```

After `const { requireAdmin } = auth;` add:

```js
// loadShow is a hoisted function declaration further down.
const { requireShowCode, requireTargetCode } = createShowAccess({ loadShow, isAdmin: auth.isAdmin });

const SEQ_FIELDS = ['name', 'steps', 'audioPath', 'audioDuration', 'bpm', 'bpmConfidence'];
function pickSeqFields(body) {
  const out = {};
  for (const k of SEQ_FIELDS) if (body && body[k] !== undefined) out[k] = body[k];
  return out;
}
```

- [ ] **Step 5: Wire into `server/app.js` — show routes**

Replace `GET /api/shows/:showName`'s `res.json(data);` with `res.json(publicShow(data));`.

Replace the whole `POST /api/shows/:showName` route ("Create or update show metadata") with:

```js
// Suggested code for the create form — one generator for client and server.
app.get('/api/codes/suggest', (req, res) => res.json({ code: generateCode() }));

// Seed a brand-new show with the admin's default .qxw template, if any.
function seedTemplate(name, show) {
  const s = loadSettings();
  if (!s.defaultQxwPath || !fs.existsSync(s.defaultQxwPath)) return;
  try {
    const uploadsDir = path.join(showPath(name), 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const dest = path.join(uploadsDir, 'template.qxw');
    fs.copyFileSync(s.defaultQxwPath, dest);
    show.qxwPath  = dest;
    show.fixtures = extractFixtures(parseQxw(dest));
  } catch (e) {
    console.error('Template seed failed:', e.message);
  }
}

// Create a show. The only non-admin response that ever carries the code.
app.post('/api/shows', (req, res) => {
  const named = checkNewName(req.body?.name);
  if (!named.ok) return res.status(400).json({ error: 'invalid_name', message: named.message });
  const name = named.name;
  if (fs.existsSync(showPath(name))) {
    return res.status(409).json({ error: 'name_taken', message: 'A show with that name already exists.' });
  }

  let editCode = generateCode();
  if (req.body?.editCode) {
    const c = checkCustomCode(req.body.editCode);
    if (!c.ok) return res.status(400).json({ error: 'invalid_code', message: c.message });
    editCode = c.code;
  }

  const now  = new Date().toISOString();
  const show = { name, sequences: [], createdAt: now, updatedAt: now, editCode };
  seedTemplate(name, show);
  saveShow(name, show);
  res.status(201).json({ ...publicShow(show), editCode });
});

// Update show metadata — only fixtureRoles is client-editable.
app.post('/api/shows/:showName', requireShowCode, (req, res) => {
  const { showName } = req.params;
  const show = loadShow(showName);
  if (req.body?.fixtureRoles !== undefined) show.fixtureRoles = req.body.fixtureRoles;
  show.updatedAt = new Date().toISOString();
  saveShow(showName, show);
  res.json(publicShow(show));
});

// Lets the client verify a code without changing anything.
app.post('/api/shows/:showName/unlock', requireShowCode, (req, res) => res.json({ ok: true }));
```

- [ ] **Step 6: Wire into `server/app.js` — protect the remaining writes**

Make these exact route-signature changes (middleware goes **before** `upload.single`):

```js
app.post('/api/shows/:showName/qxw',   requireShowCode, upload.single('qxw'),   (req, res) => {
app.post('/api/shows/:showName/audio', requireShowCode, upload.single('audio'), (req, res) => {
app.post('/api/shows/:showName/sequences',               requireShowCode, (req, res) => {
app.put('/api/shows/:showName/sequences/:seqId',         requireShowCode, (req, res) => {
app.delete('/api/shows/:showName/sequences/:seqId',      requireShowCode, (req, res) => {
app.post('/api/shows/:showName/archive',                 requireShowCode, (req, res) => {
app.patch('/api/shows/:showName/sequences/order',        requireShowCode, (req, res) => {
app.post('/api/shows/:showName/sequences/:seqId/copy',   requireTargetCode, (req, res) => {
app.delete('/api/shows/:showName/uploads/:filename',     requireShowCode, (req, res) => {
```

Inside handlers:

- `qxw` and `audio`: first line of each handler: `if (!req.file) return res.status(400).json({ error: 'No file uploaded' });`
- `qxw`: replace `const show = loadShow(showName) ?? { name: showName, … };` with `const show = loadShow(showName);`.
- `POST sequences`: replace the body with:

```js
  const { showName } = req.params;
  const show = loadShow(showName);
  const seq  = { id: uuid(), name: 'New Sequence', steps: [], ...pickSeqFields(req.body), createdAt: new Date().toISOString() };
  show.sequences = [...(show.sequences ?? []), seq];
  show.updatedAt = new Date().toISOString();
  saveShow(showName, show);
  res.json(seq);
```

- `PUT sequence`: replace `{ ...show.sequences[idx], ...req.body, id: seqId, updatedAt: … }` with `{ ...show.sequences[idx], ...pickSeqFields(req.body), id: seqId, updatedAt: new Date().toISOString() }`.
- `PATCH order`: after `const { ids } = req.body;` add `if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });`.
- `copy`: replace `copy.id = require('uuid').v4();` with `copy.id = uuid();`.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add server/lib/showAccess.js server/app.js tests/show-access.test.js
git commit -m "feat: require a show's edit code for every change to it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Startup code migration and admin code management

**Files:**
- Create: `tests/migration.test.js`
- Modify: `server/app.js`, `server/index.js`

**Interfaces:**
- Produces: `assignMissingCodes(): number` exported from `server/app.js`; `GET /api/admin/codes` → `[{ name, editCode }]` sorted by name; `PUT /api/admin/codes/:showName` `{ editCode }` → `{ ok: true, editCode }` | 400 `invalid_code` | 404.

- [ ] **Step 1: Write failing tests**

`tests/migration.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `t.mod.assignMissingCodes is not a function`.

- [ ] **Step 3: Implement in `server/app.js`**

Add after `invalidateShow`:

```js
// Every show must have a code. Runs at startup; also covers restores.
function ensureCode(name) {
  const show = loadShow(name);
  if (!show || show.editCode) return false;
  show.editCode = generateCode();
  saveShow(name, show);
  return true;
}

function assignMissingCodes() {
  if (!fs.existsSync(SHOWS_DIR)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(SHOWS_DIR)) {
    if (isSafeName(name) && ensureCode(name)) n++;
  }
  if (n) console.log(`Assigned edit code to ${n} existing show(s)`);
  return n;
}
```

In `POST /api/archive/:showName/restore`, after `invalidateShow(showName);` add `ensureCode(showName);`.

In `POST /api/archive/:showName/copy`, replace the "Update name in show.json" block with:

```js
  invalidateShow(newName);
  const copied = loadShow(newName) ?? { name: newName, sequences: [] };
  copied.name      = newName;
  copied.editCode  = generateCode();   // a copy is a new show with its own code
  copied.updatedAt = new Date().toISOString();
  saveShow(newName, copied);
```

Add the admin code routes after the archive routes:

```js
app.get('/api/admin/codes', requireAdmin, (req, res) => {
  if (!fs.existsSync(SHOWS_DIR)) return res.json([]);
  const rows = fs.readdirSync(SHOWS_DIR)
    .filter(isSafeName)
    .map(name => ({ name, editCode: loadShow(name)?.editCode }))
    .filter(r => r.editCode)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(rows);
});

app.put('/api/admin/codes/:showName', requireAdmin, (req, res) => {
  const show = loadShow(req.params.showName);
  if (!show) return res.status(404).json({ error: 'Show not found' });
  const c = checkCustomCode(req.body?.editCode);
  if (!c.ok) return res.status(400).json({ error: 'invalid_code', message: c.message });
  show.editCode = c.code;
  saveShow(req.params.showName, show);
  res.json({ ok: true, editCode: c.code });
});
```

Change the export line to `module.exports = { app, assignMissingCodes };`.

`server/index.js`:

```js
const { app, assignMissingCodes } = require('./app');

const PORT = process.env.PORT || 3000;
assignMissingCodes();
app.listen(PORT, () => console.log(`Show Creator running at http://localhost:${PORT}`));
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/index.js tests/migration.test.js
git commit -m "feat: assign codes to existing shows; admin can view and change codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Client code store, `writeShow()`, and the code prompt

**Files:**
- Create: `client/src/lib/showCodes.js`, `client/src/components/CodePrompt.jsx`
- Modify: `client/src/App.jsx`, `client/src/styles.css`

**Interfaces:**
- Consumes: `api`, `BASE` from `client/src/api.js`; server error strings `code_required` / `code_wrong`.
- Produces (`client/src/lib/showCodes.js`):
  - `getCode(show): string|null`, `setCode(show, code)`, `forgetCode(show)`
  - `getAdminToken(): string|null`, `ADMIN_TOKEN_KEY = 'adminToken'`
  - `onCodeRequest(fn: ({ show, reason }) => Promise<string|null>): () => void`
  - `class CodeCancelled extends Error { show }`
  - `writeShow(show, path, opts?, { header? }?): Promise<Response>` — throws `CodeCancelled` if the user cancels the prompt.
- `CodePromptHost` (default export of `CodePrompt.jsx`) is mounted once in `App`.

- [ ] **Step 1: Create `client/src/lib/showCodes.js`**

```js
import { api, BASE } from '../api';

// Stable (/) and beta (/beta) share one origin and can have shows with the
// same name, so codes are stored per base path.
const KEY = `showCodes:${BASE || '/'}`;
export const ADMIN_TOKEN_KEY = 'adminToken';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch {}
}

export function getCode(show)        { return readAll()[show] ?? null; }
export function setCode(show, code)  { const m = readAll(); m[show] = code; writeAll(m); }
export function forgetCode(show)     { const m = readAll(); delete m[show]; writeAll(m); }
export function getAdminToken() {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch { return null; }
}

// ── Prompt bridge ── CodePromptHost registers itself; writeShow asks it.
let listener = null;
const pending = new Map();   // show → Promise, so parallel failures share one prompt

export function onCodeRequest(fn) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

function requestCode(show, reason) {
  if (pending.has(show)) return pending.get(show);
  const p = (listener ? listener({ show, reason }) : Promise.resolve(null))
    .finally(() => pending.delete(show));
  pending.set(show, p);
  return p;
}

export class CodeCancelled extends Error {
  constructor(show) { super(`Edit code not entered for ${show}`); this.name = 'CodeCancelled'; this.show = show; }
}

const AUTH_ERRORS = new Set(['code_required', 'code_wrong']);

/**
 * A write to a show. Attaches the stored code (and admin token, if any). If
 * the server wants a code, asks the user, stores the answer and retries.
 * Copying into another show passes { header: 'X-Target-Show-Code' } and the
 * target show's name.
 */
export async function writeShow(show, path, opts = {}, { header = 'X-Show-Code' } = {}) {
  for (;;) {
    const headers = new Headers(opts.headers);
    const code  = getCode(show);
    const token = getAdminToken();
    if (code)  headers.set(header, code);
    if (token) headers.set('x-admin-token', token);

    const res = await api(path, { ...opts, headers });
    if (res.status !== 401 && res.status !== 403) return res;

    const body = await res.clone().json().catch(() => ({}));
    if (!AUTH_ERRORS.has(body.error)) return res;

    const entered = await requestCode(show, body.error);
    if (!entered) throw new CodeCancelled(show);
    setCode(show, entered);
  }
}
```

- [ ] **Step 2: Create `client/src/components/CodePrompt.jsx`**

```jsx
import React, { useState, useEffect } from 'react';
import { onCodeRequest } from '../lib/showCodes';

export default function CodePromptHost() {
  const [req, setReq]     = useState(null);   // { show, reason, resolve }
  const [value, setValue] = useState('');

  useEffect(() => onCodeRequest(({ show, reason }) => new Promise(resolve => {
    setValue('');
    setReq({ show, reason, resolve });
  })), []);

  if (!req) return null;

  function finish(code) {
    req.resolve(code);
    setReq(null);
  }

  return (
    <div className="modal-overlay" onClick={() => finish(null)}>
      <div className="modal-box code-prompt" onClick={e => e.stopPropagation()}>
        <h3 className="code-prompt-title">🔒 “{req.show}” is locked</h3>
        <p className="code-prompt-text">Enter its code to make changes.</p>
        <form onSubmit={e => { e.preventDefault(); if (value.trim()) finish(value.trim()); }}>
          <input
            className="input"
            autoFocus
            autoComplete="off"
            placeholder="e.g. K7M-4QX"
            value={value}
            onChange={e => setValue(e.target.value)}
          />
          {req.reason === 'code_wrong' && <p className="admin-error">That code didn't match.</p>}
          <div className="code-prompt-actions">
            <button type="button" className="btn-secondary" onClick={() => finish(null)}>Cancel</button>
            <button className="btn-primary" disabled={!value.trim()}>Unlock</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount in `client/src/App.jsx`**

Add `import CodePromptHost from './components/CodePrompt';` and render `<CodePromptHost />` as the last child of `<div className="app">` (after `</main>`).

- [ ] **Step 4: Styles** — append to `client/src/styles.css`:

```css
/* ── Show codes ─────────────────────────────────────────────────────────── */
.code-prompt { max-width: 360px; }
.code-prompt-title { margin: 0 0 6px; font-size: 16px; }
.code-prompt-text  { margin: 0 0 12px; color: var(--text-dim); font-size: 13px; }
.code-prompt-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.locked-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; font-size: 13px;
  background: var(--panel-2); border-bottom: 1px solid var(--border); color: var(--text-dim);
}
.code-notice {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; font-size: 13px;
  background: var(--panel-2); border: 1px solid var(--accent); border-radius: 8px; margin: 10px 14px;
}
.code-notice strong { font-size: 15px; letter-spacing: 1px; color: var(--accent); }
.new-show-code { max-width: 150px; font-family: ui-monospace, monospace; }
.form-error { color: var(--danger, #dc2626); font-size: 12px; margin: 6px 0 0; }
```

- [ ] **Step 5: Build**

Run: `npm run build --prefix client`
Expected: `✓ built`. Then `git checkout -- client/dist`.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/showCodes.js client/src/components/CodePrompt.jsx client/src/App.jsx client/src/styles.css
git commit -m "feat(client): code store, writeShow helper and unlock prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Use codes in show list, show editor and storage

**Files:**
- Modify: `client/src/App.jsx`, `client/src/components/ShowList.jsx`, `client/src/components/ShowEditor.jsx`, `client/src/components/StorageManager.jsx`

**Interfaces:**
- Consumes: `writeShow`, `setCode`, `getCode`, `getAdminToken`, `CodeCancelled` (Task 7); `POST /api/shows`, `GET /api/codes/suggest`, `POST …/unlock` (Task 5).
- Produces: `ShowList` prop `onOpen(name, newCode?)`; `ShowEditor` prop `newCode?: string`.

- [ ] **Step 1: `App.jsx` — carry the new code to the editor**

Add state `const [newCode, setNewCode] = useState(null);`. Change the `ShowList` `onOpen` to `(name, code) => { setShowName(name); setNewCode(code ?? null); setView('show'); }` and render `<ShowEditor showName={showName} newCode={newCode} onExit={…} />`.

- [ ] **Step 2: `ShowList.jsx` — create with a code, archive with a code**

Imports: `import { writeShow, setCode, CodeCancelled } from '../lib/showCodes';`

Add state and suggestion loader:

```jsx
  const [newCode, setNewCode] = useState('');
  const [formErr, setFormErr] = useState('');
  const [listErr, setListErr] = useState('');

  function suggest() {
    api('/api/codes/suggest').then(r => r.json()).then(d => setNewCode(d.code)).catch(() => {});
  }
  useEffect(suggest, []);
```

Replace `createShow`:

```jsx
  async function createShow() {
    const name = newName.trim();
    if (!name) return;
    setFormErr('');
    const res = await api('/api/shows', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, editCode: newCode.trim() || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setFormErr(data.message ?? 'Could not create the show.'); return; }
    setCode(data.name, data.editCode);
    setNewName('');
    suggest();
    onOpen(data.name, data.editCode);
  }
```

Replace `archiveShow`:

```jsx
  async function archiveShow(name) {
    setConfirmArch(null);
    setListErr('');
    try {
      const res = await writeShow(name, `/api/shows/${encodeURIComponent(name)}/archive`, { method: 'POST' });
      if (!res.ok) { setListErr(`Could not archive "${name}".`); return; }
      setShows(prev => prev.filter(s => s.name !== name));
    } catch (e) {
      if (!(e instanceof CodeCancelled)) setListErr(`Could not archive "${name}".`);
    }
  }
```

In the `new-show-row`, add between the name input and the Create button:

```jsx
        <input
          className="input new-show-code"
          placeholder="Edit code"
          title="Anyone with this code can edit or archive the show"
          value={newCode}
          onChange={e => setNewCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createShow()}
        />
        <button className="btn-ghost" type="button" onClick={suggest} title="Suggest another code">↻</button>
```

After the `new-show-row` div: `{formErr && <p className="form-error">{formErr}</p>}`. Above `card-grid`: `{listErr && <p className="form-error">{listErr}</p>}`.

- [ ] **Step 3: `StorageManager.jsx` — delete with the file's show code**

Import `{ writeShow, CodeCancelled }` from `'../lib/showCodes'`. In `deleteFile`, replace the `await api(...)` call with:

```jsx
      await writeShow(showName, `/api/shows/${encodeURIComponent(showName)}/uploads/${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
      });
```

Leave the existing `catch` (it reloads the list, which also covers `CodeCancelled`).

- [ ] **Step 4: `ShowEditor.jsx` — every write through `writeShow`, check `res.ok`**

Imports: `import { writeShow, getCode, getAdminToken, CodeCancelled } from '../lib/showCodes';`. Signature: `export default function ShowEditor({ showName, newCode, onExit })`.

Add helpers inside the component, after `showToast`:

```jsx
  const write = (path, opts) => writeShow(showName, path, opts);

  // JSON write that throws on any non-OK response so callers' catch blocks fire.
  async function writeJson(path, method, body) {
    const res = await write(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function failed(e, msg) {
    showToast(e instanceof CodeCancelled ? 'Not saved — this show is locked' : msg);
  }

  const [unlocked, setUnlocked] = useState(() => !!getCode(showName) || !!getAdminToken());
  const [codeNote, setCodeNote] = useState(newCode ?? null);

  async function unlock() {
    try {
      const res = await write(`${API(showName)}/unlock`, { method: 'POST' });
      if (res.ok) setUnlocked(true);
    } catch { /* cancelled */ }
  }
```

Replace call sites:

- `saveSong`:

```jsx
    try {
      await writeJson(`${API(showName)}/sequences/${seq.id}`, 'PUT', seq);
      setSongs(prev => prev.map(s => s.id === seq.id ? seq : s));
      setUnlocked(true);
    } catch (e) { failed(e, 'Auto-save failed'); }
```

- `handleAudioFiles` loop body:

```jsx
      try {
        const seq = await writeJson(`${API(showName)}/sequences`, 'POST', { name: cleanFileName(file.name), steps: [] });
        if (!firstId) firstId = seq.id;

        const fd = new FormData();
        fd.append('audio', file);
        const up = await write(`${API(showName)}/audio`, { method: 'POST', body: fd });
        if (!up.ok) throw new Error(`HTTP ${up.status}`);
        const audio = await up.json();

        const updated = await writeJson(`${API(showName)}/sequences/${seq.id}`, 'PUT', { ...seq, audioPath: audio.path });
        setSongs(prev => [...prev, updated]);
        if (audio.warnings?.length) showToast(audio.warnings[0], 'warn');
      } catch (e) {
        failed(e, `Could not add ${file.name}`);
        if (e instanceof CodeCancelled) break;
      }
```

- `commitRename`: `const updated = await writeJson(\`${API(showName)}/sequences/${song.id}\`, 'PUT', { ...song, name });` and `catch (e) { failed(e, 'Rename failed'); }`.
- `deleteSong`: `await writeJson(\`${API(showName)}/sequences/${id}\`, 'DELETE');` and `catch (e) { failed(e, 'Could not delete'); }`.
- `doCopy`:

```jsx
    try {
      const res = await writeShow(target, `${API(showName)}/sequences/${id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetShow: target }),
      }, { header: 'X-Target-Show-Code' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`Copied to ${target}`, 'ok');
    } catch (e) { showToast(e instanceof CodeCancelled ? `Not copied — “${target}” is locked` : 'Copy failed'); }
```

- `uploadQxw`: `const res = await write(\`${API(showName)}/qxw\`, { method: 'POST', body: fd }); const data = await res.json();` and `catch (e) { failed(e, 'Upload failed'); }`.

Add the banner and notice at the top of **both** returned trees (song editor and song picker) — wrap each existing return value in a fragment if needed:

```jsx
      {codeNote && (
        <div className="code-notice">
          <span>Code for “{showName}”: <strong>{codeNote}</strong></span>
          <span>Write it down — anyone with this code can edit or archive the show.</span>
          <button className="btn-ghost" onClick={() => setCodeNote(null)}>Got it</button>
        </div>
      )}
      {!unlocked && (
        <div className="locked-banner">
          <span>🔒 View only — enter this show's code to make changes.</span>
          <button className="btn-secondary" onClick={unlock}>Unlock</button>
        </div>
      )}
```

- [ ] **Step 5: Build**

Run: `npm run build --prefix client`
Expected: `✓ built`, no errors. Then `git checkout -- client/dist`.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx client/src/components/ShowList.jsx client/src/components/ShowEditor.jsx client/src/components/StorageManager.jsx
git commit -m "feat(client): create shows with a code; send codes on every write

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Admin panel — password login, forced change, show codes tab

**Files:**
- Modify: `client/src/components/AdminPanel.jsx`

**Interfaces:**
- Consumes: `POST /api/admin/login` `{ password }`, `POST /api/admin/password`, `GET /api/admin/codes`, `PUT /api/admin/codes/:name`, `GET /api/codes/suggest`; `ADMIN_TOKEN_KEY`, `setCode` from `showCodes.js`.

- [ ] **Step 1: Login by password**

Replace `const TOKEN_KEY = 'adminToken';` with `import { ADMIN_TOKEN_KEY as TOKEN_KEY, setCode } from '../lib/showCodes';` (keep `adminHeaders` as is).

In `LoginForm`: rename state `pin` → `password`; send `JSON.stringify({ password })`; replace the error handling with:

```jsx
    if (res.status === 429) {
      const { retryAfter } = await res.json().catch(() => ({}));
      setErr(`Too many tries — wait ${retryAfter ?? 60} seconds.`);
      return;
    }
    if (!res.ok) { setErr('Wrong password'); return; }
    const { token, mustChangePassword } = await res.json();
    localStorage.setItem(TOKEN_KEY, token);
    onLogin(token, mustChangePassword);
```

Input: `placeholder="Password"`, `value={password}`, `onChange={e => setPassword(e.target.value)}`.

- [ ] **Step 2: Forced and voluntary password change**

Add a component above `AdminPanel`:

```jsx
function PasswordForm({ forced, onDone }) {
  const [cur, setCur]   = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg]   = useState('');

  async function submit(e) {
    e.preventDefault();
    setMsg('');
    const res = await api('/api/admin/password', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(forced ? { newPassword: next } : { currentPassword: cur, newPassword: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg('✗ ' + (data.message ?? 'Failed')); return; }
    setCur(''); setNext('');
    setMsg('✓ Password changed');
    onDone?.();
  }

  return (
    <form onSubmit={submit} className="admin-pin-form">
      {!forced && (
        <input className="input" type="password" placeholder="Current password"
          value={cur} onChange={e => setCur(e.target.value)} />
      )}
      <input className="input" type="password" placeholder="New password (min 8)" autoFocus={forced}
        value={next} onChange={e => setNext(e.target.value)} />
      <button className="btn-secondary" disabled={next.length < 8 || (!forced && !cur)}>
        {forced ? 'Set password' : 'Update password'}
      </button>
      {msg && <span className={msg.startsWith('✓') ? 'admin-msg' : 'admin-error'}>{msg}</span>}
    </form>
  );
}
```

In `AdminPanel`: add `const [mustChange, setMustChange] = useState(false);`. Delete the `pinCur`/`pinNew`/`pinMsg` state and `changePin`. Change `if (!token) return <LoginForm onLogin={setToken} />;` to:

```jsx
  if (!token) return <LoginForm onLogin={(t, must) => { setToken(t); setMustChange(!!must); }} />;
  if (mustChange) {
    return (
      <div className="admin-login">
        <div className="admin-login-box">
          <h2 className="admin-login-title">Set an admin password</h2>
          <p className="admin-field-hint">The old PIN only works once. Choose a password of at least 8 characters.</p>
          <PasswordForm forced onDone={() => setMustChange(false)} />
        </div>
      </div>
    );
  }
```

The data-loading `useEffect` must also skip while `mustChange`: change its guard to `if (!token || mustChange) return;` and its deps to `[token, mustChange]`. Add to it: a stale token check —

```jsx
    api('/api/archive', { headers: adminHeaders() }).then(r => {
      if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); setToken(null); return []; }
      if (r.status === 403) { setMustChange(true); return []; }
      return r.json();
    }).then(setArchive).catch(() => {});
```

(replacing the existing archive fetch line).

Replace the "Change admin PIN" heading and form with:

```jsx
          <h3 className="admin-section-title" style={{ marginTop: 36 }}>Change admin password</h3>
          <PasswordForm />
```

- [ ] **Step 3: Show codes tab**

State: `const [codes, setCodes] = useState([]);` and `const [codeEdit, setCodeEdit] = useState({});`. In the loading effect add:

```jsx
    api('/api/admin/codes', { headers: adminHeaders() }).then(r => r.ok ? r.json() : []).then(setCodes).catch(() => {});
```

Functions:

```jsx
  async function suggestFor(name) {
    const { code } = await api('/api/codes/suggest').then(r => r.json());
    setCodeEdit(p => ({ ...p, [name]: code }));
  }

  async function saveCode(name) {
    const editCode = codeEdit[name]?.trim();
    if (!editCode) return;
    const res = await api(`/api/admin/codes/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ editCode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg('✗ ' + (data.message ?? 'Could not change code')); setTimeout(() => setMsg(''), 3000); return; }
    setCodes(prev => prev.map(c => c.name === name ? { ...c, editCode: data.editCode } : c));
    setCodeEdit(p => ({ ...p, [name]: '' }));
    setCode(name, data.editCode);   // the admin's own browser keeps working
    setMsg(`✓ Code changed for "${name}"`); setTimeout(() => setMsg(''), 2500);
  }
```

Tab button next to the others:

```jsx
          <button className={`admin-tab${tab === 'codes' ? ' admin-tab-active' : ''}`} onClick={() => setTab('codes')}>Show codes</button>
```

Tab body after the archive tab block:

```jsx
      {tab === 'codes' && (
        <div className="admin-section">
          <h3 className="admin-section-title">Show codes</h3>
          <p className="admin-field-hint" style={{ marginBottom: 10 }}>
            Anyone with a show's code can edit or archive it. Changing a code locks out everyone using the old one.
          </p>
          {codes.length === 0 && <p className="muted">No shows yet.</p>}
          {codes.map(c => (
            <div key={c.name} className="archive-row">
              <div className="archive-info">
                <span className="archive-name">{c.name}</span>
                <span className="archive-meta" style={{ fontFamily: 'ui-monospace, monospace' }}>{c.editCode}</span>
              </div>
              <div className="archive-copy-row">
                <input
                  className="input archive-copy-input"
                  placeholder="New code"
                  value={codeEdit[c.name] ?? ''}
                  onChange={e => setCodeEdit(p => ({ ...p, [c.name]: e.target.value }))}
                />
                <button className="btn-ghost" type="button" onClick={() => suggestFor(c.name)} title="Suggest a code">↻</button>
                <button className="btn-secondary" onClick={() => saveCode(c.name)} disabled={!codeEdit[c.name]?.trim()}>Change</button>
              </div>
            </div>
          ))}
        </div>
      )}
```

Update the tab comment: `// 'settings' | 'archive' | 'codes'`.

- [ ] **Step 4: Build**

Run: `npm run build --prefix client`
Expected: `✓ built`. Then `git checkout -- client/dist`.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AdminPanel.jsx
git commit -m "feat(admin): password login, forced first change, show codes tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Show Player — bridge token, exe check, safe rendering

**Files:**
- Create: `show-player/bridge-guard.js`, `tests/bridge-guard.test.js`
- Modify: `show-player/server.js`, `show-player/main.js`, `show-player/app.html`

**Interfaces:**
- Produces (`show-player/bridge-guard.js`): `isAllowedQlcExe(p: string): boolean`; `requireToken(token: string)` → Express middleware (403 `{ error: 'bad_token' }`; lets `OPTIONS` through).
- Env: `BRIDGE_TOKEN` set by `main.js` before `require('./server')`. Page reads it from `?t=`.

- [ ] **Step 1: Write failing tests**

`tests/bridge-guard.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../show-player/bridge-guard'`.

- [ ] **Step 3: Implement `show-player/bridge-guard.js`**

```js
const fs   = require('fs');
const path = require('path');

/** The bridge only ever launches QLC+ itself. */
function isAllowedQlcExe(p) {
  if (typeof p !== 'string' || !p) return false;
  const base = path.basename(p.replace(/\\/g, '/')).toLowerCase();
  if (base !== 'qlcplus' && base !== 'qlcplus.exe') return false;
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * Every request must carry the per-launch token that main.js handed the page.
 * Other web pages on this machine can reach 127.0.0.1 but can't know it.
 */
function requireToken(token) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (!token || req.get('x-bridge-token') !== token) {
      return res.status(403).json({ error: 'bad_token' });
    }
    return next();
  };
}

module.exports = { isAllowedQlcExe, requireToken };
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Wire into `show-player/server.js`**

Add `const { isAllowedQlcExe, requireToken } = require('./bridge-guard');` at the top. Replace the CORS middleware block with:

```js
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');   // page is file://
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
if (!process.env.BRIDGE_TOKEN) console.warn('BRIDGE_TOKEN not set — bridge will refuse all requests');
app.use(requireToken(process.env.BRIDGE_TOKEN));
```

In `/launch-qlc`, replace `if (!fsSync.existsSync(exe)) return res.status(400).json({ error: \`Not found: ${exe}\` });` with:

```js
  if (!isAllowedQlcExe(exe)) {
    return res.status(400).json({ error: `Not a QLC+ executable (expected qlcplus or qlcplus.exe): ${exe}` });
  }
```

Delete the whole `// ── LEDfx proxy ──` section (`app.post('/ledfx', …)`).

- [ ] **Step 6: Wire into `show-player/main.js`**

Replace `require('./server');` (and its comment) with:

```js
// Per-launch secret shared only with our own window. The bridge refuses any
// request without it, so other pages on this PC can't drive it.
const BRIDGE_TOKEN = require('crypto').randomBytes(24).toString('hex');
process.env.BRIDGE_TOKEN = BRIDGE_TOKEN;
require('./server');
```

Replace `win.loadFile('app.html');` with `win.loadFile('app.html', { query: { t: BRIDGE_TOKEN } });`.

- [ ] **Step 7: Wire into `show-player/app.html`**

After `const BRIDGE_PORT = 3848;` add:

```js
const BRIDGE_TOKEN = new URLSearchParams(location.search).get('t') || '';

function bridge(path, opts = {}) {
  return fetch(`http://127.0.0.1:${BRIDGE_PORT}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': BRIDGE_TOKEN, ...(opts.headers || {}) },
  });
}
```

Replace each of the 4 `fetch(\`http://127.0.0.1:${BRIDGE_PORT}/…\`, { … })` calls (`/find-qlc`, `/launch-qlc`, and both `/qlc`) with `bridge('/…', { method, body })`, dropping their now-duplicated `headers`. Verify none remain: `grep -n 'BRIDGE_PORT}/' show-player/app.html` → no output.

Replace the `for (const s of shows) { … }` loop in `renderShows` with:

```js
  for (const s of shows) {
    const card = el('div', 'show-card');
    card.id = 'card-' + s.name;

    const header = el('button', 'show-card-header');
    header.append(
      el('span', 'show-card-name', s.name),
      el('span', 'show-card-meta', `${s.sequences} sequence${s.sequences !== 1 ? 's' : ''}`),
    );
    const chev = el('span', 'show-card-chevron', '▼');
    chev.id = 'chev-' + s.name;
    header.append(chev);
    header.addEventListener('click', () => toggleShow(s.name));

    const launch = el('button', 'btn-launch', '🚀 Launch QLC+');
    launch.title = "Launch QLC+ with this show's workspace loaded and web API enabled";
    launch.addEventListener('click', () => launchQlc(s.name));

    const top = el('div', 'show-card-top');
    top.append(header, launch);

    const list = el('div', 'seq-list');
    list.id = 'seqs-' + s.name;
    list.style.display = 'none';

    card.append(top, list);
    area.appendChild(card);
  }
```

Replace the `for (const seq of show.sequences) { … }` loop in `renderSequences` with:

```js
  for (const seq of show.sequences) {
    const hasOsc    = !!seq.qlcFunctionId;
    const hasAudio  = !!seq.audioPath;
    const isPlaying = playing?.seqId === seq.id;

    const row = el('div', 'seq-row' + (isPlaying ? ' playing' : ''));
    row.id = 'row-' + seq.id;

    const flags = el('div', 'seq-flags');
    flags.append(
      hasOsc   ? el('span', 'flag flag-ok', 'QLC+')  : el('span', 'flag flag-warn', 'no QLC+ ID — export .qxw first'),
      hasAudio ? el('span', 'flag flag-ok', 'Audio') : el('span', 'flag flag-warn', 'no audio'),
    );
    const info = el('div', 'seq-info');
    info.append(el('div', 'seq-name', seq.name), flags);

    let btn;
    if (isPlaying) {
      btn = el('button', 'btn-seq-stop', '■ Stop');
      btn.addEventListener('click', () => stopPlayback(true));
    } else {
      btn = el('button', 'btn-play', '▶ Play');
      if (!hasAudio) { btn.disabled = true; btn.title = 'No audio uploaded for this sequence'; }
      btn.addEventListener('click', () => playSequence(name, seq.id));
    }

    row.append(info, btn);
    seqList.appendChild(row);
  }
```

Add next to `esc()`:

```js
// Build an element with text set via textContent — never parsed as HTML.
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
```

Check nothing else interpolates names into markup: `grep -n 'onclick=' show-player/app.html` — the only remaining hit should be the static `openCreator()` link in the empty state.

- [ ] **Step 8: Commit**

```bash
git add show-player/bridge-guard.js show-player/server.js show-player/main.js show-player/app.html tests/bridge-guard.test.js
git commit -m "fix(player): token-guard the local bridge, only launch QLC+, render names safely

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: every test passes; note the count in the report.

- [ ] **Step 2: Build and boot locally against throwaway data**

```bash
npm run build --prefix client
SHOWS_DIR=/tmp/sc-e2e/shows ARCHIVE_DIR=/tmp/sc-e2e/archive DATA_DIR=/tmp/sc-e2e/data NODE_ENV=production PORT=3999 node server/index.js
```

(Run the server in the background.) Expected: `Show Creator running at http://localhost:3999`.

- [ ] **Step 3: Manual browser checks at `http://localhost:3999`**

1. Create "Test Show" with the suggested code → editor opens with the code notice; add a song; edits save (no toast).
2. In a second tab, clear `localStorage` (`localStorage.clear()` via devtools), open "Test Show" → "View only" banner. Edit a step → prompt appears **once**. Enter a wrong code → "didn't match"; enter the right one → saves.
3. Show list → archive "Test Show" from the cleared tab without a code → prompt → Cancel → show still listed.
4. Admin → log in with `1234` → forced to set a password → Show codes tab lists "Test Show" → change its code → back in tab 1 (old code stored) edit a step → prompt appears → new code works.
5. Admin → 5 wrong passwords → "Too many tries — wait N seconds".
6. `curl -s --path-as-is -X POST http://localhost:3999/api/shows/../archive` → `{"error":"invalid_name",…}` and the repo is still in place.

- [ ] **Step 4: Clean up**

Stop the server; `rm -rf /tmp/sc-e2e`; `git checkout -- client/dist`; `git status` shows a clean tree.

- [ ] **Step 5: Report**

Summarize test count, the manual check results (each numbered item pass/fail), and anything skipped. Show Player changes are verified by unit tests only — the Electron app can't run here; say so.
