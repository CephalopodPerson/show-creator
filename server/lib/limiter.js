// Counts consecutive failures per key (an IP). After `max` of them the key is
// locked for `windowMs`. Entries that have gone quiet are dropped on every
// call so the map cannot grow without bound.
function createLimiter({ max, windowMs }) {
  const entries = new Map();   // key → { count, until, last }

  function purge(now) {
    for (const [key, e] of entries) {
      if (e.until ? e.until <= now : e.last + windowMs <= now) entries.delete(key);
    }
  }

  function check(key) {
    const now = Date.now();
    purge(now);
    const e = entries.get(key);
    if (e?.until) return { locked: true, retryAfter: Math.max(1, Math.ceil((e.until - now) / 1000)) };
    return { locked: false, retryAfter: 0 };
  }

  function fail(key) {
    const now = Date.now();
    purge(now);
    const e = entries.get(key) ?? { count: 0, until: 0, last: now };
    e.count += 1;
    e.last = now;
    if (e.count >= max) e.until = now + windowMs;
    entries.set(key, e);
  }

  function reset(key) {
    entries.delete(key);
  }

  return { check, fail, reset };
}

module.exports = { createLimiter };
