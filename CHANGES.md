# Changes from Upstream (jishi/node-sonos-http-api)

This document summarises all changes made in this fork relative to the upstream
repository. The work was done in several focused passes: security hardening,
Node 20+ compatibility, code refactoring, and preset/grouping reliability.

---

## Overview

The upstream project is largely unmaintained. Dependencies had accumulated
17 npm audit vulnerabilities (including 2 critical), several dependencies had
been deprecated or superseded, and the codebase contained a number of bugs
and reliability issues that became more visible on Node 18+/20+. This fork
addresses all of those while preserving full backward compatibility with
existing `settings.json`, preset files, and API endpoints.

---

## Security

All dependency vulnerabilities were resolved. Two items remain in `npm audit`
output but are confirmed false positives — npm flags `music-metadata@7.x`
because a newer version exists, but v8+ switched to ESM-only and would break
this CommonJS codebase.

| Package | Was | Now | Severity |
|---|---|---|---|
| `sonos-discovery` | GitHub tarball (blocks clean installs) | npm `^1.7.3` | — |
| `aws-sdk` | v2 (end-of-life) | Removed; replaced with `@aws-sdk/client-polly` v3 | Moderate |
| `request-promise` / `request` | Deprecated; critical vuln chain | Removed; replaced with `got@^11` | Critical |
| `anesidora` | npm package pulling in `request` chain | Vendored locally (no `request` dependency) | Critical |
| `json5` | `^0.5.1` (prototype pollution) | `^2.2.3` | High |
| `music-metadata` | `^1.1.0` | `^7.14.0` (last CJS-compatible version) | High |
| `blowfish-node` | Not present | Added; replaces OpenSSL `bf-ecb` (dropped in Node 18+) | — |
| `got` | Not present | Added `^11.8.6` (last CJS-compatible version) | — |
| `eslint` (dev) | `^4.8.0` | `^8.57.1` | High (dev-only) |
| `eslint-config-airbnb-base` (dev) | `^12.0.1` | `^15.0.0` | — |
| `eslint-plugin-import` (dev) | `^2.7.0` | `^2.32.0` | — |

**Result: 17 vulnerabilities → 2 false positives.**

---

## Node 20+ Compatibility

Node 20 changed the default HTTP agent to enable keep-alive, and OpenSSL 3
(bundled with Node 18+) removed legacy ciphers including Blowfish ECB. Both
changes broke functionality silently. Fixes are applied via a `postinstall`
script (`scripts/patch-sonos-discovery.js`) that patches `sonos-discovery`
after every `npm install`. All patches are idempotent.

### Patch 1 — HTTP keep-alive (`sonos-discovery/lib/helpers/request.js`)
Sonos players close the connection after each response and do not support
keep-alive. Node 20+'s default keep-alive agent causes subsequent requests
over a reused socket to time out. Fix: inject `new http.Agent({ keepAlive: false })`
into all outgoing UPnP requests. Equivalent to the fix in the unpublished
`v1.8.0` GitHub tag of `sonos-discovery`.

### Patch 2 — Parallel volume setting (`sonos-discovery/lib/prototypes/SonosSystem/applyPreset.js`)
`setVolume()` used a serial reduce chain — with 5 players this meant 5
sequential UPnP round-trips. One slow player could time out the entire chain.
Fix: replaced with `Promise.all()` so all volume/mute changes run in parallel,
with individual per-player catches so a single slow player logs a warning
rather than aborting the preset.

### Patch 3 — Grouping retry and verify (`sonos-discovery/lib/prototypes/SonosSystem/applyPreset.js`)
`groupWithCoordinator()` had no error handling — a single `setAVTransport`
timeout silently left a player ungrouped. Fix: each join attempt now gets one
automatic retry after 500ms. After all joins complete, a verification pass
checks `avTransportUri` against the expected grouping URI and retries any
stragglers. Grouping remains serial (Sonos rejects concurrent join requests
to the same coordinator).

### Patch 4 — Coordinator null guard (`sonos-discovery/lib/models/Player.js`)
During rapid grouping, volume-change notifications can arrive while a player's
`coordinator` reference is transiently `undefined`. An unconditional call to
`_this.coordinator.recalculateGroupVolume()` threw a `TypeError` logged as
an unhandled error. Fix: simple null guard so the call is skipped rather than
crashing.

---

## Dependency Changes

| Package | Change | Reason |
|---|---|---|
| `@aws-sdk/client-polly` | Added `^3.0.0` | Replaces deprecated `aws-sdk` v2 |
| `blowfish-node` | Added `^1.1.4` | Pure-JS Blowfish; replaces OpenSSL `bf-ecb` dropped in Node 18+ |
| `got` | Added `^11.8.6` | Replaces `request-promise`; v11 is last CJS-compatible version |
| `aws-sdk` | Removed | Replaced by `@aws-sdk/client-polly` v3 |
| `request-promise` | Removed | Replaced by `got`; was pulling in critical vuln chain |
| `anesidora` | Removed from npm | Vendored into `lib/helpers/anesidora.js` and `lib/helpers/anesidora-encryption.js` |
| `sonos-discovery` | GitHub tarball → npm `^1.7.3` | GitHub tarball blocked clean installs in many environments |
| `json5` | `^0.5.1` → `^2.2.3` | Prototype pollution fix; same `JSON5.parse()` API |
| `music-metadata` | `^1.1.0` → `^7.14.0` | Security fix; capped at v7 — v8+ is ESM-only |
| `elevenlabs-node` | Kept at `2.0.1` | No change |
| `wav-file-info` | Kept at `0.0.8` | No change |

---

## Code Refactoring

### Bugs Fixed
- **`voicerss.js`** — `fs.unlink(dest)` in the download error handler referenced an undefined variable (`dest`); corrected to `filepath`. Would have thrown a second error on download failure, masking the original.
- **`musicSearch.js`** — Unreachable `return promise` after an `if`-branch `return` removed. `trackPos`/`artistPos`/`newTerm` declarations hoisted out of their `if` block so they remain in scope for the `searchType` assignment that follows.
- **`all-player-announcement.js`** / **`preset-announcement.js`** — `oneGroupPromise` never rejected and had no timeout. If topology never converged (e.g. a player was offline), `sayall`/`clipall`/`saypreset` would hang indefinitely. Added a 10-second timeout that rejects with a clear error.
- **`spotifyDef.js`** — `console.log('spotify', clientId, clientSecret)` in `getHeaders()` printed Spotify credentials to stdout on every authentication call. Removed.
- **`siriusXM.js`** — `require('request-promise')` was imported but never called. Removed.
- **`http-event-server.js`** / **`file-duration.js`** — Missing `'use strict'` directive added.
- **`single-player-announcement.js`** — Module-level `backupPresets = {}` accumulated queue entries indefinitely and could leave a stale entry after an error, permanently preventing restores on that player until server restart. Replaced with a `Map` plus `getQueue()`/`releaseQueue()` helpers that clean up after themselves when a player's queue drains to zero. Queue semantics are unchanged — concurrent `say` calls on the same player still queue correctly.
- **`sonos-http-api.js`** — `invokeWebhook` called `JSON.stringify()` without error handling. During topology changes, `Player.toJSON()` can access a transiently `undefined` coordinator, throwing a `TypeError`. Wrapped in `try/catch`; serialization failures are logged at debug level and the notification is skipped.
- **`mac-os.js`** — `exec()` with a string command was vulnerable to shell injection if the TTS phrase contained double-quotes or backticks. Replaced with `execFile()` and an arguments array.
- **`settings.js`** — `fs.mkdirSync()` calls lacked `{ recursive: true }`, which would throw if intermediate directories didn't exist.

### Reliability
- **`try-download-tts.js`** — If all TTS providers returned `undefined` (none configured, or all failed silently), the chain resolved with `undefined` and caused a confusing crash downstream. Now rejects explicitly with a clear error message.
- **`pauseall.js`** — A second `pauseall` call before `resumeall` silently discarded the first pause state. Now logs a warning when called while already paused.

### Deduplication
- **`lib/helpers/save-all-zones.js`** (new) — Extracted the identical `saveAll()` function that existed in both `all-player-announcement.js` and `preset-announcement.js`.
- **`lib/helpers/tts-cache.js`** (new) — Extracted the identical 15-line TTS file-cache pattern (hash phrase → build filename → check if cached → return duration) that was copy-pasted across all six TTS providers. Provides `getTTSCache()`, `checkTTSCache()`, and `resolveTTSFile()`.
- **`lib/helpers/shuffle.js`** (new) — Pure Fisher-Yates shuffle utility replacing two identical `Array.prototype.shuffle` mutations (in `musicSearch.js` and `libraryDef.js`). Does not mutate the input array or modify the global `Array` prototype.

### Modernization
- **`var` → `const`/`let`** throughout `musicSearch.js`, `spotifyDef.js`, `libraryDef.js`, `pandora.js`, `pauseall.js`, `server.js`, and others.
- **`==` → `===`** (strict equality) throughout all music service files, action handlers, and helpers.
- **`musicSearch.js`** — `getService()` if/else ladder replaced with a lookup map. `getRequestOptions()` abstraction removed (vestigial after the `request-promise` → `got` migration). `Array.indexOf() === -1` replaced with `Array.includes()`. `Array.some()` replaces inner duplicate-check `for` loops.
- **`spotifyDef.js`** — `authenticateService()` unwrapped from the explicit Promise constructor anti-pattern; now chains directly off `auth()`.
- **`pandora.js`** — `console.log` error logging replaced with `logger.error()`/`logger.warn()`.
- **`libraryDef.js`** — `console.log` error logging replaced with `logger.error()`. `Array.some()` replaces inner duplicate-check loop.
- **`elevenlabs.js`** — `console.log` replaced with `logger`. Unused `http` import removed.
- **`mac-os.js`** — `var` declarations replaced with `const`/`let`. `selcetedRate` typo corrected to `selectedRate`. Unused `http` import removed.
- **`aws-polly.js`** — Unused `crypto`, `fs`, `http`, `path` imports removed (now handled by `tts-cache.js`).
- **`sonos-http-api.js`** — `response.constructor.name === 'IncomingMessage'` replaced with `instanceof http.IncomingMessage` (the string name check is fragile under minification or subclassing).
- **`server.js`** — Stale commented-out auth bypass block removed.

---

## New Files

| File | Purpose |
|---|---|
| `lib/helpers/anesidora.js` | Vendored Pandora API client (from `dlom/anesidora@1.2.1`); `request` replaced with `got`, `underscore` removed, `new Buffer()` updated |
| `lib/helpers/anesidora-encryption.js` | Vendored Blowfish encryption for Pandora; OpenSSL `bf-ecb` (removed in Node 18+) replaced with `blowfish-node` (pure JS). Also restores Pandora functionality on modern Node as a side effect |
| `lib/helpers/save-all-zones.js` | Shared zone snapshot helper for announcement restore logic |
| `lib/helpers/shuffle.js` | Pure Fisher-Yates shuffle; does not mutate input or global `Array.prototype` |
| `lib/helpers/tts-cache.js` | Shared TTS file-cache helper eliminating copy-paste across all six TTS providers |
| `scripts/patch-sonos-discovery.js` | Post-install patcher applying four fixes to `sonos-discovery@1.7.3` that are present in the unpublished `v1.8.0` tag or were introduced by this fork. Runs automatically via the `postinstall` npm hook. Idempotent |

---

## Known Limitations

- **`music-metadata` capped at v7.14.0** — v8 and above switched to ESM-only modules, which are incompatible with this CommonJS codebase without a broader migration. npm audit will flag this as a vulnerability but no CVE exists against v7.14.0 specifically.
- **`got` capped at v11.8.6** — Same reason; v12+ is ESM-only.
- **`sayall` reliability** — The `sayall`/`clipall` commands group all players into a single zone, play the announcement, then attempt to restore the previous topology. This restore step uses `sonos-discovery`'s `applyPreset`, which can fail under the same timeout conditions described above. The 10-second topology timeout (added in this fork) prevents indefinite hangs, but `sayall` remains less reliable than single-player `say` due to the complexity of full-system grouping and restore.
- **`sonos-discovery` patches** — Rather than forking `sonos-discovery`, fixes are applied post-install via `scripts/patch-sonos-discovery.js`. This is pragmatic but means the patches must be re-verified if `sonos-discovery` is ever upgraded.
- **Pandora** — The Pandora API uses Blowfish encryption, which was removed from OpenSSL 3 (Node 18+). This fork restores Pandora functionality using the pure-JS `blowfish-node` library. However, Pandora's JSON API itself is unofficial and may change or be discontinued at any time.
- **Microsoft TTS** — The Microsoft Cognitive Services (Bing Speech) API used by this provider is legacy and may no longer be available to new registrations.
