const { codesMatch } = require('./codes');
const { isSafeName } = require('./names');
const { createLimiter } = require('./limiter');

const MAX_WRONG_CODES = 10;
const CODE_LOCK_MS    = 60 * 1000;

/** A show as the public API may see it — never the edit code. */
function publicShow(show) {
  if (!show) return show;
  const { editCode, ...rest } = show;
  return rest;
}

// One place decides write access. Google sign-in later becomes another
// "allow" branch here; no route needs to change.
// Wrong codes are counted per IP *per show*: a correct code resets the count,
// and anyone can create a show (so knows one code) — a per-IP-only count
// could be reset between guesses with the guesser's own show.
function createShowAccess({ loadShow, isAdmin, limiter = createLimiter({ max: MAX_WRONG_CODES, windowMs: CODE_LOCK_MS }) }) {
  function check(req, showName, header) {
    const show = loadShow(showName);
    if (!show) return [404, { error: 'Show not found' }];
    if (isAdmin(req)) return null;
    const given = req.get(header);
    if (!given) return [401, { error: 'code_required', show: showName }];
    const key  = `${req.ip}\n${showName}`;
    const lock = limiter.check(key);
    if (lock.locked) return [429, { error: 'locked', retryAfter: lock.retryAfter, show: showName }];
    if (!codesMatch(show.editCode, given)) {
      limiter.fail(key);
      return [403, { error: 'code_wrong', show: showName }];
    }
    limiter.reset(key);
    return null;
  }

  function requireShowCode(req, res, next) {
    const fail = check(req, req.params.showName, 'x-show-code');
    if (fail) return res.status(fail[0]).json(fail[1]);
    next();
  }

  function requireTargetCode(req, res, next) {
    const target = req.body?.targetShow;
    if (typeof target !== 'string' || !isSafeName(target)) {
      return res.status(400).json({ error: 'targetShow required' });
    }
    const fail = check(req, target, 'x-target-show-code');
    if (fail) return res.status(fail[0]).json(fail[1]);
    next();
  }

  return { requireShowCode, requireTargetCode };
}

module.exports = { createShowAccess, publicShow };
