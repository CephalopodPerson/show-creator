// Minimal local server — proxies QLC+ WebSocket API calls to avoid CORS issues.
const express   = require('express');
const WebSocket = require('ws');

const app  = express();
const PORT = 3848;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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

app.listen(PORT, '127.0.0.1', () =>
  console.log(`Show Player QLC+ bridge running on port ${PORT}`)
);
