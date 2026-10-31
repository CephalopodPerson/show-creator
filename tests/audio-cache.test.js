const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createAudioCache, keyOf } = require('../show-player/audio-cache');

// A tiny file server whose content and availability the test controls.
async function fakeServer() {
  const state = { body: Buffer.from('song-v1'), etag: '"v1"', down: false, hits: 0, stall: false };
  const srv = http.createServer((req, res) => {
    state.hits++;
    if (state.down) return req.socket.destroy();
    if (req.headers['if-none-match'] === state.etag) { res.writeHead(304); return res.end(); }
    res.writeHead(200, { ETag: state.etag, 'Content-Length': state.body.length + (state.stall ? 10 : 0) });
    if (state.stall) return res.write(state.body);   // never finishes
    res.end(state.body);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/shows/My%20Show/uploads/01%20Song.mp3`;
  return { state, url, close: () => { srv.closeAllConnections(); srv.close(); } };
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'audio-cache-'));

test('keys keep the audio extension and reject anything path-like', () => {
  const key = keyOf('https://x.test/shows/A/uploads/track.MP3');
  assert.match(key, /^[0-9a-f]{40}\.mp3$/);
  assert.match(keyOf('https://x.test/a/b.exe'), /\.bin$/);
  const cache = createAudioCache(tmpDir());
  assert.equal(cache.pathFor('../../etc/passwd'), null);
  assert.equal(cache.pathFor(key + '.json'), null);
  assert.ok(cache.pathFor(key));
});

test('downloads once, then reuses the copy while the server says unchanged', async t => {
  const s = await fakeServer(); t.after(s.close);
  const cache = createAudioCache(tmpDir());

  assert.equal(cache.isCached(s.url), false);
  const first = await cache.ensure(s.url);
  assert.equal(first.fresh, true);
  assert.equal(fs.readFileSync(cache.pathFor(first.key), 'utf8'), 'song-v1');
  assert.equal(cache.isCached(s.url), true);

  const second = await cache.ensure(s.url);
  assert.equal(second.fresh, false);   // 304 — nothing re-downloaded
});

test('a replaced upload is picked up', async t => {
  const s = await fakeServer(); t.after(s.close);
  const cache = createAudioCache(tmpDir());
  const { key } = await cache.ensure(s.url);

  s.state.body = Buffer.from('song-v2'); s.state.etag = '"v2"';
  assert.equal((await cache.ensure(s.url)).fresh, true);
  assert.equal(fs.readFileSync(cache.pathFor(key), 'utf8'), 'song-v2');
});

test('offline: plays the saved copy; with no copy, reports the failure', async t => {
  const s = await fakeServer(); t.after(s.close);
  const cache = createAudioCache(tmpDir());
  const { key } = await cache.ensure(s.url);

  s.state.down = true;
  const r = await cache.ensure(s.url);
  assert.equal(r.stale, true);
  assert.equal(r.key, key);
  assert.equal(fs.readFileSync(cache.pathFor(key), 'utf8'), 'song-v1');

  await assert.rejects(createAudioCache(tmpDir()).ensure(s.url));
});

test('a stalled download gives up and leaves no half file behind', async t => {
  const s = await fakeServer(); t.after(s.close);
  s.state.stall = true;
  const dir = tmpDir();
  const cache = createAudioCache(dir, { idleTimeoutMs: 200 });
  await assert.rejects(cache.ensure(s.url), /stalled|abort/i);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(cache.isCached(s.url), false);
});

test('preferCached answers from disk without asking the server', async t => {
  const s = await fakeServer(); t.after(s.close);
  const cache = createAudioCache(tmpDir());
  await cache.ensure(s.url);
  const before = s.state.hits;
  s.state.stall = true;   // a hanging connection must not delay Play
  const r = await cache.ensure(s.url, { preferCached: true });
  assert.equal(r.fresh, false);
  assert.equal(s.state.hits, before);
});

test('parallel requests for one song share a single download', async t => {
  const s = await fakeServer(); t.after(s.close);
  const cache = createAudioCache(tmpDir());
  await Promise.all([cache.ensure(s.url), cache.ensure(s.url), cache.ensure(s.url)]);
  assert.equal(s.state.hits, 1);
});
