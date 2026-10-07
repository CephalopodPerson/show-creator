const { codesMatch } = require('./codes');
const { isSafeName } = require('./names');

/** A show as the public API may see it — never the edit code. */
function publicShow(show) {
  if (!show) return show;
  const { editCode, ...rest } = show;
  return rest;
}

// One place decides write access. Google sign-in later becomes another
// "allow" branch here; no route needs to change.
function createShowAccess({ loadShow, isAdmin }) {
  function check(req, showName, header) {
    const show = loadShow(showName);
    if (!show) return [404, { error: 'Show not found' }];
    if (isAdmin(req)) return null;
    const given = req.get(header);
    if (!given) return [401, { error: 'code_required', show: showName }];
    if (!codesMatch(show.editCode, given)) return [403, { error: 'code_wrong', show: showName }];
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
