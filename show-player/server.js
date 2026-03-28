// Minimal local server — only purpose is sending OSC UDP packets to QLC+.
// The browser cannot send UDP directly, so requests come here first.
const express = require('express');
const dgram   = require('dgram');

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

// ── OSC helpers ───────────────────────────────────────────────────────────────
function oscString(str) {
  const nulled = str + '\0';
  const padded = Math.ceil(nulled.length / 4) * 4;
  const buf    = Buffer.alloc(padded, 0);
  buf.write(nulled, 0, 'ascii');
  return buf;
}

function sendOsc(host, port, functionId, action) {
  return new Promise((resolve, reject) => {
    const address  = `/qlcplus/function/${functionId}`;
    const packet   = Buffer.concat([
      oscString(address),
      oscString(',f'),
      (() => { const b = Buffer.allocUnsafe(4); b.writeFloatBE(parseFloat(action) || 0, 0); return b; })(),
    ]);
    const sock = dgram.createSocket('udp4');
    sock.send(packet, 0, packet.length, port, host, err => {
      sock.close();
      if (err) reject(err); else resolve();
    });
  });
}

// POST /osc  { host?, port?, functionId, action }
app.post('/osc', async (req, res) => {
  const { host = '127.0.0.1', port = 7700, functionId, action = 1 } = req.body;
  if (functionId == null) return res.status(400).json({ error: 'functionId required' });
  try {
    await sendOsc(host, parseInt(port), parseInt(functionId), action);
    res.json({ ok: true });
  } catch (e) {
    console.error('OSC error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '127.0.0.1', () =>
  console.log(`Show Player OSC bridge running on port ${PORT}`)
);
