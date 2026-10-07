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

/** Log in on a fresh server and complete the forced password change. */
async function adminToken(t) {
  const login = await t.json('POST', '/api/admin/login', { password: '1234' });
  const token = login.body.token;
  await t.json('POST', '/api/admin/password', { newPassword: 'test-password-1' }, { 'x-admin-token': token });
  return token;
}

module.exports = { startServer, adminToken };
