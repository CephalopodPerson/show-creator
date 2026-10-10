// Minimal local server — proxies QLC+ WebSocket API calls to avoid CORS issues.
const express   = require('express');
const WebSocket = require('ws');
const { isAllowedQlcExe, isQlc5, requireToken } = require('./bridge-guard');

const app  = express();
const PORT = 3848;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');   // page is file://
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
if (!process.env.BRIDGE_TOKEN) console.warn('BRIDGE_TOKEN not set — bridge will refuse all requests');
app.use(requireToken(process.env.BRIDGE_TOKEN));

// POST /qlc  { host?, port?, functionId, action }
// Sends a QLC+ WebSocket API message: QLC+API|setFunctionStatus|<id>|<0|1>
app.post('/qlc', async (req, res) => {
  const { host = '127.0.0.1', port = 9999, functionId, action = 1 } = req.body;
  if (functionId == null) return res.status(400).json({ error: 'functionId required' });

  const status  = action ? 1 : 0;
  const message = `QLC+API|setFunctionStatus|${functionId}|${status}`;
  const wsUrl   = `ws://${host}:${port}/qlcplusWS`;

  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, 4000);

      ws.on('open', () => {
        ws.send(message);
        clearTimeout(timer);
        // Give QLC+ a moment to process, then close
        setTimeout(() => { ws.close(); resolve(); }, 200);
      });
      ws.on('error', err => { clearTimeout(timer); reject(err); });
    });

    res.json({ ok: true, message });
  } catch (e) {
    console.error('QLC+ WS error:', e.message);
    res.status(500).json({
      error: `Could not reach QLC+ at ${host}:${port} — is QLC+ running with -w flag?`,
    });
  }
});

// ── Launch QLC+ with web server enabled, optionally loading a workspace ──────
// POST /launch-qlc  { exePath?, qxwUrl?, showName? }
// Downloads the .qxw from the VPS (if given) then spawns:
//   qlcplus.exe -w -o <file> -p
const { spawn }  = require('child_process');
const os         = require('os');
const fsp        = require('fs/promises');
const fsSync     = require('fs');
const pathMod    = require('path');

// Common install locations to probe when the user hasn't set one
const QLC_GUESSES = [
  'C:\\QLC+\\qlcplus.exe',
  'C:\\Program Files\\QLC+\\qlcplus.exe',
  'C:\\Program Files (x86)\\QLC+\\qlcplus.exe',
  'C:\\QLC+5\\qlcplus5.exe',
  'C:\\Program Files\\QLC+5\\qlcplus5.exe',
  '/usr/bin/qlcplus',
  '/Applications/QLC+.app/Contents/MacOS/qlcplus',
];

const qlcVersion = exe => (isQlc5(exe) ? 5 : 4);

// Venues run QLC+ 4 and 5 side by side, so report every install found
app.get('/find-qlc', (req, res) => {
  const installs = QLC_GUESSES
    .filter(p => { try { return fsSync.existsSync(p); } catch { return false; } })
    .map(p => ({ path: p, version: qlcVersion(p) }));
  res.json({ found: installs[0]?.path ?? null, installs, candidates: QLC_GUESSES });
});

app.post('/launch-qlc', async (req, res) => {
  const { exePath, qxwUrl, showName, operate = true } = req.body;

  const exe = exePath || QLC_GUESSES.find(p => { try { return fsSync.existsSync(p); } catch { return false; } });
  if (!exe) return res.status(400).json({ error: 'QLC+ executable not found — set the path in Settings' });
  if (!isAllowedQlcExe(exe)) {
    return res.status(400).json({ error: `Not a QLC+ executable (expected qlcplus.exe or qlcplus5.exe): ${exe}` });
  }

  const args = ['-w'];   // always enable the web API

  // Download the workspace file locally so QLC+ can open it
  let localQxw = null;
  if (qxwUrl) {
    try {
      const r = await fetch(qxwUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const dir = pathMod.join(os.tmpdir(), 'show-player');
      await fsp.mkdir(dir, { recursive: true });
      localQxw = pathMod.join(dir, `${(showName || 'show').replace(/[^\w.-]+/g, '_')}.qxw`);
      await fsp.writeFile(localQxw, buf);
      args.push('-o', localQxw);
    } catch (e) {
      return res.status(502).json({ error: `Could not download workspace: ${e.message}` });
    }
  }

  // Start in Operate mode. QLC+ 5 has no such flag and exits on unknown ones.
  if (operate && !isQlc5(exe)) args.push('-p');

  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.unref();
    res.json({ ok: true, exe, version: qlcVersion(exe), args, workspace: localQxw });
  } catch (e) {
    res.status(500).json({ error: `Launch failed: ${e.message}` });
  }
});

// Exported so main.js can report a port clash instead of crashing
module.exports = app.listen(PORT, '127.0.0.1', () =>
  console.log(`Show Player bridge running on port ${PORT}`)
);
