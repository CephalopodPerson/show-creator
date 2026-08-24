const express     = require('express');
const multer      = require('multer');
const cors        = require('cors');
const path        = require('path');
const fs          = require('fs');
const dgram       = require('dgram');
const compression = require('compression');
const { v4: uuid } = require('uuid');
const { parseQxw, extractFixtures, mergeAndWrite } = require('./qlc');

const app  = express();
const PORT = process.env.PORT || 3000;
const SHOWS_DIR    = process.env.SHOWS_DIR || path.join(__dirname, '..', 'shows');
const ARCHIVE_DIR  = process.env.ARCHIVE_DIR || path.join(__dirname, '..', 'archive');
const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
const ADMIN_PIN    = process.env.ADMIN_PIN || '1234';

// ── Release channel ───────────────────────────────────────────────────────────
// 'stable' or 'beta'. Each channel runs as its own PM2 process on its own port
// with its own SHOWS_DIR, so beta can't corrupt live show data — the beta step
// format (layered colour + effects) is not readable by the stable exporter.
const CHANNEL     = process.env.CHANNEL === 'beta' ? 'beta' : 'stable';
const OTHER_URL   = process.env.OTHER_CHANNEL_URL || '';

// In-memory admin sessions (token → expiry)
const adminSessions = new Map();

app.use(compression());
app.use(cors());
app.use(express.json());

// ── Settings helpers ──────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  defaultBrightness: 45,
  maxBrightness:     60,
  adminPin:          null,   // null → falls back to ADMIN_PIN env / '1234'
  defaultQxwPath:    null,   // template .qxw applied to new shows
  ledfx: { enabled: false, host: '127.0.0.1', port: 8888, virtuals: [] },
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(data) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

function currentPin() {
  return loadSettings().adminPin || process.env.ADMIN_PIN || '1234';
}

// ── Admin auth middleware ─────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const exp   = adminSessions.get(token);
  if (!token || !exp || Date.now() > exp) return res.status(401).json({ error: 'Admin auth required' });
  adminSessions.set(token, Date.now() + 4 * 60 * 60 * 1000); // refresh
  next();
}

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

// In-memory show cache keyed by name → { mtimeMs, data }.
// Avoids re-reading + re-parsing show.json on every request, which was the
// main cost on show-list and show-open (both hit every show file).
const showCache = new Map();

function loadShow(name) {
  const p = showJsonPath(name);
  let st;
  try { st = fs.statSync(p); } catch { return null; }

  const hit = showCache.get(name);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.data;

  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    showCache.set(name, { mtimeMs: st.mtimeMs, data });
    return data;
  } catch { return null; }
}

function saveShow(name, data) {
  fs.mkdirSync(showPath(name), { recursive: true });
  fs.writeFileSync(showJsonPath(name), JSON.stringify(data, null, 2));
  try {
    showCache.set(name, { mtimeMs: fs.statSync(showJsonPath(name)).mtimeMs, data });
  } catch { showCache.delete(name); }
}

function invalidateShow(name) { showCache.delete(name); }

// ── Routes ───────────────────────────────────────────────────────────────────

// Which channel is this instance, and where's the other one?
app.get('/api/channel', (req, res) => {
  res.json({ channel: CHANNEL, otherUrl: OTHER_URL });
});

// Settings — public read strips secrets; admin write
app.get('/api/settings', (req, res) => {
  const { adminPin, ...safe } = loadSettings();
  res.json(safe);
});
app.put('/api/settings', requireAdmin, (req, res) => {
  const { adminPin, ...rest } = req.body;   // PIN only changes via its own route
  const s = { ...loadSettings(), ...rest };
  saveSettings(s);
  const { adminPin: _p, ...safe } = s;
  res.json(safe);
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  if (String(req.body.pin) !== String(currentPin())) return res.status(401).json({ error: 'Wrong PIN' });
  const token = uuid();
  adminSessions.set(token, Date.now() + 4 * 60 * 60 * 1000);
  res.json({ token });
});

// Change admin PIN
app.post('/api/admin/pin', requireAdmin, (req, res) => {
  const { currentPin: cur, newPin } = req.body;
  if (String(cur) !== String(currentPin())) return res.status(401).json({ error: 'Current PIN is incorrect' });
  if (!newPin || String(newPin).length < 4) return res.status(400).json({ error: 'New PIN must be at least 4 characters' });
  const s = loadSettings();
  s.adminPin = String(newPin);
  saveSettings(s);
  res.json({ ok: true });
});

// Upload a default .qxw template (admin)
const templateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'data');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, 'default-template.qxw'),
  }),
});

app.post('/api/admin/template', requireAdmin, templateUpload.single('qxw'), (req, res) => {
  try {
    const doc      = parseQxw(req.file.path);
    const fixtures = extractFixtures(doc);
    const s = loadSettings();
    s.defaultQxwPath = req.file.path;
    saveSettings(s);
    res.json({ ok: true, fixtures });
  } catch (e) {
    res.status(400).json({ error: 'Could not parse .qxw: ' + e.message });
  }
});

app.get('/api/admin/template', requireAdmin, (req, res) => {
  const s = loadSettings();
  if (!s.defaultQxwPath || !fs.existsSync(s.defaultQxwPath)) return res.json({ present: false });
  try {
    const fixtures = extractFixtures(parseQxw(s.defaultQxwPath));
    res.json({ present: true, fixtures, size: fs.statSync(s.defaultQxwPath).size });
  } catch {
    res.json({ present: true, fixtures: [] });
  }
});

// List all shows (excludes archived)
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
  const isNew    = !loadShow(showName);
  const existing = loadShow(showName) ?? { name: showName, sequences: [], createdAt: new Date().toISOString() };
  const updated  = { ...existing, ...req.body, name: showName, updatedAt: new Date().toISOString() };

  // Brand-new show: seed it with the admin's default .qxw template if one exists
  if (isNew && !updated.qxwPath) {
    const s = loadSettings();
    if (s.defaultQxwPath && fs.existsSync(s.defaultQxwPath)) {
      try {
        const uploadsDir = path.join(showPath(showName), 'uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });
        const dest = path.join(uploadsDir, 'template.qxw');
        fs.copyFileSync(s.defaultQxwPath, dest);
        updated.qxwPath  = dest;
        updated.fixtures = extractFixtures(parseQxw(dest));
      } catch (e) {
        console.error('Template seed failed:', e.message);
      }
    }
  }

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

// Serve uploaded audio files.
// Uploads are content-addressed by filename and effectively immutable, so we
// cache aggressively — this was causing a full re-download of every audio file
// each time a show page was opened.
app.use('/shows', express.static(SHOWS_DIR, {
  maxAge:    '30d',
  etag:      true,
  lastModified: true,
  immutable: true,
}));

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

// ── Archive a show (moves to archive dir) ────────────────────────────────────
app.post('/api/shows/:showName/archive', (req, res) => {
  const { showName } = req.params;
  const src = showPath(showName);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Show not found' });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const dst = path.join(ARCHIVE_DIR, showName);
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.renameSync(src, dst);
  invalidateShow(showName);
  res.json({ ok: true });
});

// ── List archived shows ───────────────────────────────────────────────────────
app.get('/api/archive', requireAdmin, (req, res) => {
  if (!fs.existsSync(ARCHIVE_DIR)) return res.json([]);
  const shows = fs.readdirSync(ARCHIVE_DIR)
    .filter(d => fs.statSync(path.join(ARCHIVE_DIR, d)).isDirectory())
    .map(name => {
      try {
        const p = path.join(ARCHIVE_DIR, name, 'show.json');
        const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
        return { name, sequences: data?.sequences?.length ?? 0, updatedAt: data?.updatedAt };
      } catch { return { name, sequences: 0 }; }
    });
  res.json(shows);
});

// ── Restore show from archive ─────────────────────────────────────────────────
app.post('/api/archive/:showName/restore', requireAdmin, (req, res) => {
  const { showName } = req.params;
  const src = path.join(ARCHIVE_DIR, showName);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Not in archive' });
  const dst = showPath(showName);
  if (fs.existsSync(dst)) return res.status(409).json({ error: 'A show with that name already exists' });
  fs.renameSync(src, dst);
  invalidateShow(showName);
  res.json({ ok: true });
});

// ── Hard-delete a show from archive (admin only) ──────────────────────────────
app.delete('/api/archive/:showName', requireAdmin, (req, res) => {
  const { showName } = req.params;
  const dir = path.join(ARCHIVE_DIR, showName);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not in archive' });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

// ── Copy from archive to active shows ────────────────────────────────────────
app.post('/api/archive/:showName/copy', requireAdmin, (req, res) => {
  const { showName } = req.params;
  const src = path.join(ARCHIVE_DIR, showName);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Not in archive' });
  const newName = req.body.name || showName + ' (copy)';
  const dst = showPath(newName);
  if (fs.existsSync(dst)) return res.status(409).json({ error: 'Name already taken' });
  fs.cpSync(src, dst, { recursive: true });
  // Update name in show.json
  const jsonPath = path.join(dst, 'show.json');
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    data.name = newName; data.updatedAt = new Date().toISOString();
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  }
  res.json({ ok: true, name: newName });
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

// ── Serve the exported .qxw for a show (used by Show Player auto-launch) ────
// Re-exports on demand so the file is always current, then streams it.
app.get('/api/shows/:showName/qxw-file', (req, res) => {
  const { showName } = req.params;
  const show = loadShow(showName);
  if (!show)          return res.status(404).json({ error: 'Show not found' });
  if (!show.qxwPath)  return res.status(400).json({ error: 'No .qxw uploaded for this show' });
  if (!fs.existsSync(show.qxwPath)) return res.status(400).json({ error: 'Source .qxw missing' });

  const fixtures = show.fixtures ?? [];
  const fixtureRoles = show.fixtureRoles ?? {
    par:  fixtures.find(f => f.model?.toLowerCase().includes('rgb'))?.id ?? fixtures[1]?.id,
    spot: fixtures.find(f => f.model?.toLowerCase().includes('beam') || f.model?.toLowerCase().includes('spot'))?.id ?? fixtures[0]?.id,
  };
  const outPath = path.join(showPath(showName), `${showName.replace(/\s+/g, '_')}.qxw`);

  try {
    const result = mergeAndWrite(show.qxwPath, outPath, show.sequences ?? [], fixtureRoles, showName);
    if (result.seqIdMap && Object.keys(result.seqIdMap).length > 0) {
      const updated = loadShow(showName);
      if (updated) {
        updated.sequences = (updated.sequences ?? []).map(s => ({
          ...s, qlcFunctionId: result.seqIdMap[s.id] ?? s.qlcFunctionId,
        }));
        updated.updatedAt = new Date().toISOString();
        saveShow(showName, updated);
      }
    }
    res.sendFile(outPath);
  } catch (e) {
    res.status(500).json({ error: 'Export failed: ' + e.message });
  }
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

// ── Storage ───────────────────────────────────────────────────────────────────
function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((total, f) => {
    const full = path.join(dir, f);
    try { return total + fs.statSync(full).size; } catch { return total; }
  }, 0);
}

// GET /api/storage — total + per-show breakdown with file lists
app.get('/api/storage', (req, res) => {
  if (!fs.existsSync(SHOWS_DIR)) return res.json({ totalBytes: 0, shows: [] });
  const shows = fs.readdirSync(SHOWS_DIR)
    .filter(d => fs.statSync(path.join(SHOWS_DIR, d)).isDirectory())
    .map(name => {
      const uploadsDir = path.join(SHOWS_DIR, name, 'uploads');
      const files = fs.existsSync(uploadsDir)
        ? fs.readdirSync(uploadsDir).map(f => {
            const full = path.join(uploadsDir, f);
            try {
              return { name: f, size: fs.statSync(full).size };
            } catch { return null; }
          }).filter(Boolean)
        : [];
      const showBytes = files.reduce((t, f) => t + f.size, 0);
      return { name, bytes: showBytes, files };
    });
  const totalBytes = shows.reduce((t, s) => t + s.bytes, 0);
  res.json({ totalBytes, shows });
});

// DELETE /api/shows/:showName/uploads/:filename — remove a single uploaded file
app.delete('/api/shows/:showName/uploads/:filename', (req, res) => {
  const { showName, filename } = req.params;
  // Prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(SHOWS_DIR, showName, 'uploads', safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filePath);

  // If it was the qxw for this show, clear qxwPath from show.json
  const show = loadShow(showName);
  if (show && show.qxwPath && path.basename(show.qxwPath) === safe) {
    show.qxwPath  = null;
    show.fixtures = [];
    show.updatedAt = new Date().toISOString();
    saveShow(showName, show);
  }
  res.json({ ok: true });
});

// ── Catch-all for React in production ────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

app.listen(PORT, () => console.log(`Show Creator running at http://localhost:${PORT}`));
