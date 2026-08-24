// ── Base-path aware URL helper ────────────────────────────────────────────────
// The app can be served at the site root (stable) or under a sub-path such as
// /beta. Vite bakes that sub-path into import.meta.env.BASE_URL at build time.
//
// Every server URL the client builds — API calls and uploaded audio alike —
// must go through u(). Without it, a request from the /beta app would be sent
// to /api/... and nginx would route it to the *stable* instance, silently
// mixing the two channels' data.

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

/** Prefix a server-absolute path with the app's base path. */
export function u(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;      // already absolute
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${p}`;
}

/** fetch() that resolves paths against the base path. */
export function api(path, options) {
  return fetch(u(path), options);
}

export { BASE };
