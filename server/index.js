const express  = require('express');
const multer   = require('multer');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const dgram    = require('dgram');
const { v4: uuid } = require('uuid');
const { parseQxw, extractFixtures, mergeAndWrite } = require('./qlc');

const app  = express();
const PORT = process.env.PORT || 3000;
// SHOWS_DIR can be overridden by Electron main process to use the OS user-data dir
const SHOWS_DIR = process.env.SHOWS_DIR || path.join(__dirname, '..', 'shows');

app.use(cors());
app.use(express.json());

// Serve React build in production (Electron sets CLIENT_DIST to the correct path)
const CLIENT_DIST = process.env.CLIENT_DIST || path.join(__dirname, '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(CLIENT_DIST));
}

// File uploads (qxw + audio) go into shows/<showName>/uploads/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const showDir = path.join(SHOWS_DIR, req.params.showName, 'uploads');
    fs.mkdirSync(showDir, { recursive: true });
    cb(null, showDir);
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

// ── Helpers ──────────────────────────────────────────────────────────────────
function showPath(name)     { return path.join(SHOWS_DIR, name); }
function showJsonPath(name) { return path.join(showPath(name), 'show.json'); }

function loadShow(name) {
  const p = showJsonPath(name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveShow(name, data) {
  fs.mkdirSync(showPath(name), { recursive: true });
  fs.writeFileSync(showJsonPath(name), JSON.stringify(data, null, 2));
}

// ── Routes ───────────────────────────────────────────────────────────────────

// List all shows
app.get('/api/shows', (req, res) => {
  if (!fs.existsSync(SHOWS_DIR)) return res.json([]);
  const shows = fs.readdirSync(SHOWS_DIR)
    .filter(d => fs.statSync(path.join(SHOWS_DIR, d)).isDirectory())
    .map(name => {
      const data = loadShow(name);
      return { name, sequences: data?.sequences?.length ?? 0, updatedAt: data?.updatedAt };
    });
  res.json(shows);
});

// Get a show
app.get('/api/shows/:showName', (req, res) => {
  const data = loadShow(req.params.showName);
  if (!data) return res.status(404).json({ error: 'Show not found' });
  res.json(data);
});

// Create or update show metadata
app.post('/api/shows/:showName', (req, res) => {
  const { showName } = req.params;
  const existing = loadShow(showName) ?? { name: showName, sequences: [], createdAt: new Date().toISOString() };
  const updated  = { ...existing, ...req.body, name: showName, updatedAt: new Date().toISOString() };
  saveShow(showName, updated);
  res.json(updated);
});

// Upload .qxw file — extracts fixtures and stores reference
app.post('/api/shows/:showName/qxw', upload.single('qxw'), (req, res) => {
  const { showName } = req.params;
  const filePath = req.file.path;

  try {
    const doc      = parseQxw(filePath);
    const fixtures = extractFixtures(doc);
    const show     = loadShow(showName) ?? { name: showName, sequences: [], createdAt: new Date().toISOString() };
    show.qxwPath   = filePath;
    show.fixtures  = fixtures;
    show.updatedAt = new Date().toISOString();
    saveShow(showName, show);
    res.json({ fixtures });
  } catch (e) {
    res.status(400).json({ error: 'Could not parse .qxw: ' + e.message });
  }
});

// Upload audio file for a sequence
app.post('/api/shows/:showName/audio', upload.single('audio'), (req, res) => {
  const { showName } = req.params;
  const file = req.file;

  // Basic DRM / quality check
  const warnings = [];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.mp3', '.wav', '.flac', '.aiff', '.ogg'].includes(ext)) {
    warnings.push('File type may not be supported. Use MP3, WAV, FLAC, or AIFF.');
  }
  if (file.size < 500000) {
    warnings.push('File is very small — may be low quality or incomplete.');
  }
  // Note: proper DRM detection requires deeper inspection; this is a basic heuristic
  if (file.originalname.toLowerCase().includes('drm') || ext === '.m4p') {
    warnings.push('This file may be DRM-protected and may not play correctly.');
  }

  res.json({
    filename:  file.originalname,
    path:      `/shows/${showName}/uploads/${file.originalname}`,
    serverPath: file.path,
    warnings,
  });
});

// Serve uploaded audio files
app.use('/shows', express.static(SHOWS_DIR));

// ── Sequences CRUD ───────────────────────────────────────────────────────────

// Get all sequences for a show
app.get('/api/shows/:showName/sequences', (req, res) => {
  const show = loadShow(req.params.showName);
  if (!show) return res.status(404).json({ error: 'Show not found' });
  res.json(show.sequences ?? []);
});

// Create a new sequence
app.post('/api/shows/:showName/sequences', (req, res) => {
  const { showName } = req.params;
  const show = loadShow(showName) ?? { name: showName, sequences: [], createdAt: new Date().toISOString() };
  const seq  = { id: uuid(), name: req.body.name ?? 'New Sequence', steps: [], ...req.body, createdAt: new Date().toISOString() };
  show.sequences = [...(show.sequences ?? []), seq];
  show.updatedAt = new Date().toISOString();
  saveShow(showName, show);
  res.json(seq);
});

// Update a sequence (auto-save)
app.put('/api/shows/:showName/sequences/:seqId', (req, res) => {
  const { showName, seqId } = req.params;
  const show = loadShow(showName);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const idx = show.sequences.findIndex(s => s.id === seqId);
  if (idx === -1) return res.status(404).json({ error: 'Sequence not found' });

  show.sequences[idx] = { ...show.sequences[idx], ...req.body, id: seqId, updatedAt: new Date().toISOString() };
  show.updatedAt = new Date().toISOString();
  saveShow(showName, show);
  res.json(show.sequences[idx]);
});

// Delete a sequence
app.delete('/api/shows/:showName/sequences/:seqId', (req, res) => {
  const { showName, seqId } = req.params;
  const show = loadShow(showName);
  if (!show) return res.status(404).json({ error: 'Show not found' });
  show.sequences = show.sequences.filter(s => s.id !== seqId);
  show.updatedAt = new Date().toISOString();
  saveShow(showName, show);
  res.json({ ok: true });
});

// ── Delete a show ─────────────────────────────────────────────────────────────
app.delete('/api/shows/:showName', (req, res) => {
  const { showName } = req.params;
  const dir = showPath(showName);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Show not found' });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

// ── Reorder sequences ─────────────────────────────────────────────────────────
app.patch('/api/shows/:showName/sequences/order', (req, res) => {
  const { showName } = req.params;
  const { ids } = req.body;   // array of sequence ids in new order
  const show = loadShow(showName);
  if (!show) return res.status(404).json({ error: 'Show not found' });
  const map = Object.fromEntries(show.sequences.map(s => [s.id, s]));
  show.sequences = ids.map(id => map[id]).filter(Boolean);
  show.updatedAt = new Date().toISOString();
  saveShow(showName, show);
  res.json({ ok: true });
});

// ── Copy a sequence to another show ──────────────────────────────────────────
app.post('/api/shows/:showName/sequences/:seqId/copy', (req, res) => {
  const { showName, seqId } = req.params;
  const { targetShow } = req.body;
  if (!targetShow) return res.status(400).json({ error: 'targetShow required' });

  const srcShow = loadShow(showName);
  if (!srcShow) return res.status(404).json({ error: 'Source show not found' });
  const seq = srcShow.sequences?.find(s => s.id === seqId);
  if (!seq) return res.status(404).json({ error: 'Sequence not found' });

  const dstShow = loadShow(targetShow);
  if (!dstShow) return res.status(404).json({ error: 'Target show not found' });

  // Deep-copy, give a fresh id, clear audio path (can't assume it exists in target)
  const copy = JSON.parse(JSON.stringify(seq));
  copy.id        = require('uuid').v4();
  copy.audioPath = null;
  copy.audioDuration = null;
  // Append "(copy)" if a sequence with the same name already exists
  const nameExists = dstShow.sequences?.some(s => s.name === copy.name);
  if (nameExists) copy.name = copy.name + ' (copy)';

  dstShow.sequences = [...(dstShow.sequences ?? []), copy];
  dstShow.updatedAt = new Date().toISOString();
  saveShow(targetShow, dstShow);
  res.json(copy);
});

// ── Export ───────────────────────────────────────────────────────────────────
app.post('/api/shows/:showName/export', (req, res) => {
  const { showName } = req.params;
  const show = loadShow(showName);
  if (!show) return res.status(404).json({ error: 'Show not found' });
  if (!show.qxwPath) return res.status(400).json({ error: 'No .qxw file uploaded for this show' });

  // Determine fixture roles from show config or use first two fixtures
  const fixtures = show.fixtures ?? [];
  const fixtureRoles = show.fixtureRoles ?? {
    par:  fixtures.find(f => f.model?.toLowerCase().includes('rgb'))?.id ?? fixtures[1]?.id,
    spot: fixtures.find(f => f.model?.toLowerCase().includes('beam') || f.model?.toLowerCase().includes('spot'))?.id ?? fixtures[0]?.id,
  };

  const outPath = path.join(showPath(showName), `${showName.replace(/\s+/g, '_')}.qxw`);

  // Check source file actually exists before trying to parse it
  if (!fs.existsSync(show.qxwPath)) {
    return res.status(400).json({ error: `Source .qxw not found at: ${show.qxwPath}` });
  }

  try {
    const result = mergeAndWrite(show.qxwPath, outPath, show.sequences ?? [], fixtureRoles, showName);
    // Persist QLC+ function IDs back into show.json so the Player can trigger them via OSC
    if (result.seqIdMap && Object.keys(result.seqIdMap).length > 0) {
      const updated = loadShow(showName);
      if (updated) {
        updated.sequences = (updated.sequences ?? []).map(s => ({
          ...s,
          qlcFunctionId: result.seqIdMap[s.id] ?? s.qlcFunctionId,
        }));
        updated.updatedAt = new Date().toISOString();
        saveShow(showName, updated);
      }
    }
    res.download(outPath, path.basename(outPath), err => {
      if (err) console.error('Export download error:', err);
    });
  } catch (e) {
    console.error('Export error:', e);
    res.status(500).json({ error: 'Export failed: ' + e.message });
  }
});

// ── OSC trigger ──────────────────────────────────────────────────────────────
// Sends a single OSC message to QLC+ to start or stop a sequence by function ID.
// host defaults to localhost; port defaults to QLC+ default OSC input port 7700.
// action: 1 = start, 0 = stop
function sendOsc(host, port, functionId, action) {
  return new Promise((resolve, reject) => {
    // Build a minimal OSC bundle manually (no external library needed):
    //   address: /qlcplus/function/N  (null-padded to 4-byte boundary)
    //   type tag string: ,f           (float argument)
    //   float value: 1.0 or 0.0
    const address   = `/qlcplus/function/${functionId}`;
    const addrBuf   = oscString(address);
    const typeBuf   = oscString(',f');
    const floatBuf  = Buffer.allocUnsafe(4);
    floatBuf.writeFloatBE(parseFloat(action) || 0, 0);
    const packet    = Buffer.concat([addrBuf, typeBuf, floatBuf]);

    const sock = dgram.createSocket('udp4');
    sock.send(packet, 0, packet.length, port, host, (err) => {
      sock.close();
      if (err) reject(err); else resolve();
    });
  });
}

function oscString(str) {
  const nulled = str + '\0';
  const padded = Math.ceil(nulled.length / 4) * 4;
  const buf = Buffer.alloc(padded, 0);
  buf.write(nulled, 0, 'ascii');
  return buf;
}

// POST /api/osc  { host?, port?, functionId, action }
app.post('/api/osc', async (req, res) => {
  const { host = '127.0.0.1', port = 7700, functionId, action = 1 } = req.body;
  if (functionId == null) return res.status(400).json({ error: 'functionId required' });
  try {
    await sendOsc(host, parseInt(port), parseInt(functionId), action);
    res.json({ ok: true, host, port, functionId, action });
  } catch (e) {
    console.error('OSC send error:', e);
    res.status(500).json({ error: 'OSC send failed: ' + e.message });
  }
});

// ── Catch-all for React in production ────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

app.listen(PORT, () => console.log(`Show Creator running at http://localhost:${PORT}`));
