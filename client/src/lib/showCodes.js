import { api, BASE } from '../api';

// Stable (/) and beta (/beta) share one origin and can have shows with the
// same name, so codes are stored per base path.
const KEY = `showCodes:${BASE || '/'}`;
export const ADMIN_TOKEN_KEY = 'adminToken';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch {}
}

export function getCode(show)        { return readAll()[show] ?? null; }
export function setCode(show, code)  { const m = readAll(); m[show] = code; writeAll(m); }
export function forgetCode(show)     { const m = readAll(); delete m[show]; writeAll(m); }
export function getAdminToken() {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch { return null; }
}

// ── Prompt bridge ── CodePromptHost registers itself; writeShow asks it.
let listener = null;
const pending = new Map();   // show → Promise, so parallel failures share one prompt

export function onCodeRequest(fn) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

function requestCode(show, reason, retryAfter) {
  if (pending.has(show)) return pending.get(show);
  const p = (listener ? listener({ show, reason, retryAfter }) : Promise.resolve(null))
    .finally(() => pending.delete(show));
  pending.set(show, p);
  return p;
}

export class CodeCancelled extends Error {
  constructor(show) { super(`Edit code not entered for ${show}`); this.name = 'CodeCancelled'; this.show = show; }
}

const AUTH_ERRORS = new Set(['code_required', 'code_wrong', 'locked']);
const AUTH_STATUSES = new Set([401, 403, 429]);

// Codes travel in an HTTP header, which only carries printable ASCII — no
// stored code can contain anything else, so such input can never match.
const SENDABLE = /^[\x20-\x7e]+$/;

/**
 * A write to a show. Attaches the stored code (and admin token, if any). If
 * the server wants a code, asks the user, stores the answer and retries.
 * Copying into another show passes { header: 'X-Target-Show-Code' } and the
 * target show's name.
 */
export async function writeShow(show, path, opts = {}, { header = 'X-Show-Code', prompt = true } = {}) {
  let code = getCode(show);
  let fromStorage = !!code;

  for (;;) {
    const headers = new Headers(opts.headers);
    const token = getAdminToken();
    if (code)  headers.set(header, code);
    if (token) headers.set('x-admin-token', token);

    const res = await api(path, { ...opts, headers });
    if (!AUTH_STATUSES.has(res.status)) {
      if (code) setCode(show, code);
      return res;
    }

    const body = await res.clone().json().catch(() => ({}));
    if (!AUTH_ERRORS.has(body.error)) {
      if (code) setCode(show, code);
      return res;
    }

    // Background writes (e.g. bpm detection) never interrupt the user with a
    // prompt — surface the auth error to the caller instead.
    if (!prompt) return res;

    // A code that came from storage and was rejected is stale (e.g. rotated
    // by the server) — drop it if the user cancels rather than keep retrying
    // with a code we know is wrong.
    const forgetOnCancel = fromStorage && body.error === 'code_wrong';

    // 'locked': too many wrong codes from this address; the server says how
    // long to wait. Treated like any other auth error — ask again.
    let reason = body.error;
    let entered;
    for (;;) {
      entered = await requestCode(show, reason, body.retryAfter);
      if (!entered || SENDABLE.test(entered)) break;
      reason = 'code_wrong';   // unsendable — it can't be right, so don't send it
    }
    if (!entered) {
      if (forgetOnCancel) forgetCode(show);
      throw new CodeCancelled(show);
    }
    code = entered;
    fromStorage = false;
  }
}
