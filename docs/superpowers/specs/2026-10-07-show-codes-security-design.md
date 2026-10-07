# Show Codes & Security Hardening — Design

**Date:** 2026-10-07
**Branch:** `feat/show-codes` (off `beta`)
**Status:** Draft for review

## Goal

Stop people from changing or archiving shows that aren't theirs, and close the
security holes found in the 2026-10-07 code review — without making the app
harder to use for the person who owns a show.

## Agreed decisions

| Topic | Decision |
|---|---|
| Code creation | App suggests a code at show creation; creator may replace it before saving |
| Existing shows | Server auto-generates a code for every show missing one, on startup |
| Admin powers | Admin can view and change any show's code; admin session overrides all codes |
| Admin login | PIN becomes a password (hashed). Google OAuth comes later — not in scope |
| Reading | Viewing, exporting, Show Player, and copying a sequence *out* need no code |
| Writing | Every change to a show needs that show's code (or admin) |
| Mechanism | Browser sends the code on every write (`X-Show-Code` header); no code sessions |

## 1. Show name validation

Two levels of rule, so existing shows on stable keep working:

- **Safety rule — every route.** A single `app.param('showName', …)` handler
  (covering `/api/archive/:showName` too) rejects with `400` any name that is
  empty, starts with `.`, or contains `/`, `\`, or a control character. As a
  final guard, the resolved path must sit directly inside `SHOWS_DIR` /
  `ARCHIVE_DIR`. This closes the path-traversal finding (`..` → app root).
- **Naming rule — new shows only.** Creation (and admin copy-from-archive's new
  name) additionally requires 1–60 characters of letters (any language),
  digits, spaces, and `- _ , ' ( ) & !`. Rejected with a readable message
  instead of creating a show that's awkward to use.

Existing shows whose names fail the naming rule but pass the safety rule keep
working unchanged.

## 2. Show codes

### Format and rules

- **Suggested codes:** 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
  (no `0/O`, `1/I/L`), displayed as `K7M-4QX`.
- **Creator-chosen codes:** 4–32 characters, printable ASCII only (codes
  travel in an HTTP header, which can't carry other characters). Rejected if
  all one character (`0000`, `aaaa`) or a straight run (`1234`, `abcd`,
  `4321`).
- **Comparison:** trimmed, case-insensitive, dashes and spaces ignored.
  `k7m 4qx` matches `K7M-4QX`. Compared with `crypto.timingSafeEqual`.

### Storage

The code lives in `show.json` as `editCode`. It is stored **readable, not
hashed**, because the admin must be able to look codes up and hand them out
(decision: admin can view codes; auto-generated codes for existing shows are
useless if nobody can read them). It is **never** included in any public API
response — every route that returns a show strips it.

Trade-off accepted: anyone who can read files on the VPS can read the codes.
Anyone with that access can already edit `show.json` directly, so hashing would
not add real protection here. The admin password, by contrast, is hashed.

### Startup migration

On server start, every show folder whose `show.json` has no `editCode` gets a
generated one. Logged as `Assigned edit code to N existing show(s)`. Idempotent:
shows that already have a code are untouched.

### Access check

One function decides write access, used as middleware on every write route:

```
canEditShow(req, showName) →
  admin session valid   → allow
  X-Show-Code matches   → allow
  otherwise             → 401 { error: 'code_required' } if no code sent
                          403 { error: 'code_wrong' }    if code sent but wrong
```

Google OAuth later becomes a third `allow` branch ("signed-in user owns this
show") without touching any route.

### Which routes need it

| Route | Code needed |
|---|---|
| `POST /api/shows/:name` (update existing) | ✅ show's code |
| `POST /api/shows/:name/unlock` | ✅ show's code |
| `POST /api/shows` (create new) | ❌ — code is set here |
| `POST /api/shows/:name/qxw`, `/audio` | ✅ |
| `POST/PUT/DELETE /api/shows/:name/sequences…`, `PATCH …/order` | ✅ |
| `POST /api/shows/:name/archive` | ✅ |
| `DELETE /api/shows/:name/uploads/:file` | ✅ |
| `POST /api/shows/:name/sequences/:id/copy` | ✅ **target** show's code (sent as `X-Target-Show-Code`); source is open |
| `GET` anything, `POST …/export`, `GET …/qxw-file` | ❌ |

`export` and `qxw-file` stay open because Show Player needs them; their side
effect (writing `qlcFunctionId` back into `show.json`) is derived data, not
user content.

**Upload ordering:** multer writes files *before* a route handler runs, so the
access check runs as middleware **before** `upload.single(...)`. A rejected
upload never touches disk.

### Create flow

Creation moves to its own route, `POST /api/shows` with `{ name, editCode? }`.
If `editCode` is absent, the server generates one. Response (`201`) includes
the code **once** (the only non-admin response that ever contains it). If the
name already exists, `409` — today it silently merges into the existing show.
`POST /api/shows/:name` remains as the code-protected *update* route.

Two small helper routes:

- `GET /api/codes/suggest` → `{ code }` — the create form's suggestion, so
  client and server share one generator.
- `POST /api/shows/:name/unlock` (code-protected, no side effects) → `{ ok }` —
  lets the "View only" banner verify a code before anything is saved.

Shows restored from the archive keep their code (or get one if they were
archived before this change). Admin "copy from archive" gives the copy a fresh
code, visible in the Admin panel.

### Whitelisted fields

Show update accepts only `{ fixtureRoles }` (the only show-level field the
client currently edits). Sequence create/update accepts only
`name, steps, audioPath, audioDuration, bpm, bpmConfidence`. Everything else
in the body is ignored. Server-owned fields (`qxwPath`, `fixtures`,
`editCode`, `createdAt`, `qlcFunctionId`) can only be set by the server.

## 3. Admin

### Password

- `settings.json` stores `adminPasswordHash` + `adminPasswordSalt`
  (`crypto.scrypt`, no new dependencies). Plain `adminPin` is removed on
  migration.
- **First login after upgrade:** the existing PIN (or `ADMIN_PIN` / `1234`)
  still works once, and the response carries `mustChangePassword: true`. The
  Admin panel shows only a "set a new password" form until it's changed.
- New password: minimum 8 characters.
- **Lockout:** 5 failed logins from the same IP → that IP is refused for
  60 seconds. In memory; resets on restart (acceptable). The server sets
  `trust proxy` to loopback so the IP comes from nginx's `X-Forwarded-For`;
  otherwise every visitor would share nginx's `127.0.0.1` and one person's
  typos would lock everyone out.
- Expired admin sessions are purged on each login.

### Code management (new Admin panel section)

A "Show codes" list: each active show with its current code and a **Change**
button (admin types a new code or clicks "suggest"). New routes, admin-only:

- `GET  /api/admin/codes` → `[{ name, editCode }]`
- `PUT  /api/admin/codes/:name` `{ editCode }` → validates with the same rules

## 4. Client

### Code store (`client/src/lib/showCodes.js`)

- `localStorage` key `showCodes:<BASE>` → `{ [showName]: code }`. Keyed by
  base path because stable and `/beta` share one origin and may have shows
  with the same name.
- `getCode(name)`, `setCode(name, code)`, `forgetCode(name)`.
- All access wrapped in try/catch; if storage is unavailable the user is just
  asked for the code more often.

### Sending it

`api()` gains an option: `api(path, { ...opts, show: name })` adds
`X-Show-Code` from the store (and `x-admin-token` if an admin session exists).
Every write call site passes `show`.

### Prompting

A small `CodePrompt` modal. Any write that returns `401 code_required` or
`403 code_wrong` opens it ("This show is locked. Enter its code to make
changes."), stores the entered code, and retries the request once. Wrong code →
inline error, stays open. Cancel → the action is abandoned and a toast says so.

Opening a show with no stored code shows a slim banner: "View only — enter
code to edit", with an Unlock button. Editing controls still work locally, but
the first auto-save triggers the prompt.

### Create flow UI

The "Create" row gets a second field pre-filled with a suggested code and a
↻ button to regenerate. After creation, a dismissible notice:
"Code for *Show name*: **K7M-4QX** — write it down. Anyone with this code can
edit or archive the show." The code is saved to the store automatically.

### Save errors

`saveSong` (and every other write) checks `res.ok`. Non-OK and network
failures both show the "Auto-save failed" toast; auth failures go through the
prompt instead.

## 5. Show Player

- **Code injection:** show and sequence cards stop building `onclick="…"`
  strings. Names are set with `textContent`; handlers attached with
  `addEventListener`. Fixes the `x');…` injection.
- **Bridge token:** `main.js` generates a random token at startup, sets it for
  `server.js` before requiring it, and passes it to the page via
  `loadFile('app.html', { query: { t } })`. Every bridge route requires
  `X-Bridge-Token`. CORS `*` stays (the page is `file://`), but no other page
  can know the token.
- **Launch path:** `/launch-qlc` only runs an `exePath` that exists and whose
  file name is `qlcplus` or `qlcplus.exe` (case-insensitive — this also covers
  the binary inside `QLC+.app` on macOS). Anything else → `400`.
- **Remove `/ledfx`** — nothing in `app.html` calls it.

## 6. Server clean-up included

- Delete `POST /api/osc` and the OSC helpers (unused since the WebSocket switch).
- Use the imported `uuid` in sequence copy instead of `require('uuid')` inline.

Explicitly **out of scope** (tracked for the restructure / later): splitting
`server/index.js` into route files, de-duplicating the export routes, the audio
filename/caching bug, wizard labels, UV timeline sliders.

## Error handling

| Situation | Server | Client |
|---|---|---|
| Bad show name | `400 { error: 'invalid_name', message }` | Inline message under the name field |
| No code sent | `401 code_required` | Code prompt |
| Wrong code | `403 code_wrong` | Prompt with "That code didn't match" |
| Admin locked out | `429 { retryAfter }` | "Too many tries — wait N seconds" |
| Name taken on create | `409` | "A show with that name already exists" |

## Testing

There are no tests in the repo today. This change adds the first ones, using
Node's built-in `node:test` (no new dependency), against the Express app with
temp `SHOWS_DIR`/`ARCHIVE_DIR`:

- safety rule on all routes: `..`, `..%2F..`, `a%2Fb`, leading dot → 400
- naming rule on create: 61 chars, `<script>` → 400; `Friday Night (Live)` passes
- each write route: no code → 401, wrong → 403, right code → 2xx, admin token → 2xx
- read routes and `export` work with no code
- sequence copy needs target code, not source code
- create returns code once; GET never returns `editCode`
- whitelist: `qxwPath` in a body is ignored
- startup migration assigns codes once and is idempotent
- admin: old PIN works once with `mustChangePassword`; 6th bad login → 429; hash stored, no plain PIN
- code rules: `1234`, `aaaa`, 3 chars rejected; case/dash-insensitive match

To make that possible, the app moves to `server/app.js` (builds and exports
the Express app) and `server/index.js` shrinks to "run migration, listen".
A `require.main === module` guard would not work: both PM2 and the Electron
wrapper *require* `server/index.js`, so it must always listen. Settings move
under `DATA_DIR` (default unchanged) so tests never touch real settings.
New helpers live in `server/lib/` (names, codes, password, admin auth, show
access) — one responsibility each.

Client and Show Player changes are checked by hand in the browser: create →
code shown → edit; second browser profile → prompt → wrong/right code; archive
locked; Show Player list renders a show named `x');alert(1);('` as plain text.
