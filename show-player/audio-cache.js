// Local copies of show audio, so a dropped connection at the venue can't stop
// a song mid-show. Files are keyed by URL; the server's ETag tells us when an
// upload was replaced, and if the server can't be reached we keep the copy we have.
const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aif', '.aiff', '.ogg', '.m4a', '.aac']);
const KEY_SHAPE  = /^[0-9a-f]{40}\.(mp3|wav|flac|aiff?|ogg|m4a|aac|bin)$/;

/** Cache file name for a URL: hash of the URL plus its audio extension (so it's served with the right type). */
function keyOf(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return crypto.createHash('sha1').update(url).digest('hex') + (AUDIO_EXTS.has(ext) ? ext : '.bin');
}

function createAudioCache(dir, { fetchImpl = fetch, idleTimeoutMs = 15000 } = {}) {
  const inflight = new Map();   // url → Promise, so a song is never downloaded twice at once
  const fileOf = key => path.join(dir, key);
  const metaOf = key => path.join(dir, key + '.json');
  const has    = key => fs.existsSync(fileOf(key));

  async function readMeta(key) {
    try { return JSON.parse(await fsp.readFile(metaOf(key), 'utf8')); } catch { return null; }
  }

  async function download(url) {
    const key  = keyOf(url);
    const meta = has(key) ? await readMeta(key) : null;
    const tmp  = fileOf(key) + '.part';

    // Abort only when the transfer goes quiet, not on total time — a long song
    // over slow venue wifi is fine as long as bytes keep arriving.
    const ctrl = new AbortController();
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(new Error('download stalled')), idleTimeoutMs); };
    arm();

    try {
      const res = await fetchImpl(url, {
        headers: meta?.etag ? { 'If-None-Match': meta.etag } : {},
        signal:  ctrl.signal,
      });
      if (res.status === 304 && meta) return { key, fresh: false };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await fsp.mkdir(dir, { recursive: true });
      const out = fs.createWriteStream(tmp);
      try {
        for await (const chunk of res.body) {
          arm();
          if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        }
        await new Promise((ok, bad) => out.end(err => (err ? bad(err) : ok())));
        await fsp.rename(tmp, fileOf(key));
      } catch (e) {
        out.destroy();
        await fsp.rm(tmp, { force: true });
        throw e;
      }
      await fsp.writeFile(metaOf(key), JSON.stringify({ url, etag: res.headers.get('etag'), savedAt: new Date().toISOString() }));
      return { key, fresh: true };
    } catch (e) {
      // Offline, server down, or the file is open for playback (Windows won't
      // replace it) — the copy we already have is still good to play.
      if (has(key)) return { key, fresh: false, stale: true, reason: e.message };
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Make sure a local copy exists (refreshing it if the server has a newer one).
   * preferCached skips the server check when a copy exists — Play uses it so a
   * hanging connection can't delay the start of a song.
   */
  function ensure(url, { preferCached = false } = {}) {
    if (preferCached && has(keyOf(url))) return Promise.resolve({ key: keyOf(url), fresh: false });
    if (!inflight.has(url)) {
      inflight.set(url, download(url).finally(() => inflight.delete(url)));
    }
    return inflight.get(url);
  }

  return {
    ensure,
    isCached: url => has(keyOf(url)),
    pathFor:  key => (KEY_SHAPE.test(key) ? fileOf(key) : null),
  };
}

module.exports = { createAudioCache, keyOf };
