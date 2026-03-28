// Minimal local server — proxies QLC+ HTTP API calls to avoid CORS issues.
const express = require('express');

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
// Proxies to QLC+ built-in web API: GET /api/function?id=N&enable=1
app.post('/qlc', async (req, res) => {
  const { host = '127.0.0.1', port = 9999, functionId, action = 1 } = req.body;
  if (functionId == null) return res.status(400).json({ error: 'functionId required' });
  const enable = action ? 1 : 0;
  const url = `http://${host}:${port}/api/function?id=${functionId}&enable=${enable}`;
  try {
    const r    = await fetch(url);
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: `QLC+ returned ${r.status}: ${text}` });
    res.json({ ok: true, qlcResponse: text });
  } catch (e) {
    console.error('QLC+ HTTP error:', e.message);
    res.status(500).json({ error: `Could not reach QLC+ at ${host}:${port} — is QLC+ running with web server enabled?` });
  }
});

app.listen(PORT, '127.0.0.1', () =>
  console.log(`Show Player QLC+ bridge running on port ${PORT}`)
);
