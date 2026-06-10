# Firefox Port — Implementation Plan

_Status: Phases 2–8 implemented (2026-06-10). Phase 1 live spike + all in-Firefox
"Verify" steps still require a manual run (interactive browser + real Spotify
login — not executable in the build environment). All code, build targets,
manifests, the bridge, and tests are landed and green. See the implementation
log at the bottom for decisions taken beyond the plan._

## Verdict

Full parity is achievable. There is exactly **one** capability Firefox lacks —
`externally_connectable` / `runtime.onMessageExternal` (web-page → extension
messaging, [bug 1319168](https://bugzilla.mozilla.org/show_bug.cgi?id=1319168),
verified still open/unimplemented as of June 2026; the W3C WebExtensions group is
standardizing it but Mozilla has no implementation underway). It is replaced by
the Firefox-sanctioned **content-script `postMessage` bridge**. Everything else
maps to Firefox unchanged. The load-bearing trick — the `world: "MAIN"` fetch
interceptor — is supported on **Firefox 128+**
([bug 1736575](https://bugzilla.mozilla.org/show_bug.cgi?id=1736575),
[MV3 in FF128](https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/)),
and MAIN-world scripts bypass the page CSP, same as Chrome.

**Minimum version: Firefox 140**, not 128. The capability floor is 128
(`world: "MAIN"`), but AMO **requires**
`browser_specific_settings.gecko.data_collection_permissions` for all new
submissions since 2025-11-03, and that key needs Firefox 140+ on desktop
([announcement](https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/)).
140 is also the current ESR, so it costs almost no reach.

## Settled decisions

- **Layout: single source tree + build targets.** ✅ The `extension/` →
  `extensions/` rename landed as commit `8ee54ab` (Phase 0 below). One `src/`,
  two manifests, `build.ts` gains `--target=chromium|firefox` →
  `dist/chromium` + `dist/firefox`. The only Firefox-specific source file is the
  bridge, excluded from the Chrome build.
- **Namespace: tiny local shim, no `webextension-polyfill`.** Research outcome
  (June 2026): Chrome MV3 APIs are promise-native, Firefox's `browser.*` always
  was — the polyfill's promise-wrapping job no longer exists (the package isn't
  deprecated, but its last release was May 2024 and it adds a dep + test-mock
  churn for nothing). Instead: a one-line `extensions/src/shared/browser.ts`
  shim — `export const browser = (globalThis.browser ?? globalThis.chrome)` —
  typed as `typeof chrome` (modern `@types/chrome` carries the promise
  overloads). Firefox resolves to native `browser.*`; Chrome to promise-native
  `chrome.*`. No new dependency, existing type refs
  (`chrome.runtime.MessageSender` etc.) stay valid.
- **Transport stays transparent.** Chrome keeps using `externally_connectable`;
  Firefox uses the bridge. Both sit behind one interface so callers don't change.
  (Unifying both browsers on the bridge is possible later — deferred to avoid
  regressing the working Chrome path.)
- **Background: keep `service_worker` for Chrome, `scripts` (event page) for
  Firefox — both ESM.** Firefox MV3 still has no `background.service_worker`
  ([bug 1573659](https://bugzilla.mozilla.org/show_bug.cgi?id=1573659), open,
  P3), but it supports `"type": "module"` event pages since Firefox 112
  ([bug 1811443](https://bugzilla.mozilla.org/show_bug.cgi?id=1811443)) — so the
  previously planned bundled-IIFE workaround is unnecessary. One ESM build
  artifact serves both targets; only the manifest key differs. Verified safe —
  the background uses no SW-only globals (`clients`/`skipWaiting`/
  `importScripts`). (Firefox 121+ would even tolerate a single manifest carrying
  both `service_worker` and `scripts` keys, but we need split manifests anyway
  for the bridge/`externally_connectable` delta.)

---

## Phase 0 — Restructure ✅ DONE (commit `8ee54ab`)

All landed and verified:

- [x] `git mv extension extensions`
- [x] `package.json` (root): `ext:build` / `ext:dev` / `ext:store` point at
      `extensions/scripts/build.ts`
- [x] `scripts/spotify-hash-sync/sync.ts`: import path updated to
      `../../extensions/src/shared/hash-registry.ts`
- [x] `.github/workflows/main.yml` paths-filter: `- 'extensions/**'`

---

## Phase 1 — De-risk spike: MAIN-world token capture on Firefox

The single highest-risk assumption. Prove it before investing in the bridge.
Research sharpened the risk: Firefox 128+ supports `world: "MAIN"` and it
bypasses page CSP, but **there is no documented guarantee that a MAIN-world
`document_start` script runs before the page's own scripts** — the
implementation bug (1736575) never discusses ordering. Chrome's ordering is
battle-tested; Firefox's must be proven empirically.

- [ ] Add a minimal `manifest.firefox.json` (MV3, `gecko.id`,
      `strict_min_version: "140.0"`, the two content scripts incl.
      `intercept-token.js` at `world: "MAIN"`, `run_at: "document_start"`,
      `background.scripts` + `"type": "module"`)
- [ ] Teach `build.ts` a throwaway `--target=firefox` that emits `dist/firefox`
- [ ] `bunx web-ext run --source-dir dist/firefox --target=firefox-desktop`
- [ ] Log in to open.spotify.com; confirm the background receives a
      `SPOTIFY_TOKEN` message (the MAIN-world `fetch` override fired before
      Spotify's app code). Reload repeatedly + hard-reload to probe ordering
      flakiness, not just the happy path.

**Acceptance:** token + at least one `PATHFINDER_HASH` captured on Firefox,
consistently across reloads. If ordering is flaky, resolve here before
proceeding. Fallback candidates, in order: (a)
`scripting.executeScript({world: "MAIN", injectImmediately: true})` from the
background on `tabs.onUpdated`; (b) the pre-FF128 pattern — isolated-world
`document_start` script DOM-injecting an inline `<script>` — but beware
[bug 1267027](https://bugzilla.mozilla.org/show_bug.cgi?id=1267027): on Firefox
the page CSP **does** apply to DOM-injected inline scripts, so (b) only works if
Spotify's CSP allows it. Everything downstream is plumbing once this holds.

---

## Phase 2 — Dual-target build system

- [ ] `build.ts`: parse `--target=chromium|firefox` (default chromium); output to
      `dist/<target>/`. Mirror the existing `--store` manifest-transform pattern.
- [ ] Split `src/manifest.json` → `src/manifest.chromium.json` (today's manifest)
      and `src/manifest.firefox.json`. Build copies the right one to
      `dist/<target>/manifest.json`.
- [ ] Firefox manifest deltas:
  - `browser_specific_settings.gecko.id` (e.g. `hearted@hearted.music`) +
    `gecko.strict_min_version: "140.0"`
  - `browser_specific_settings.gecko.data_collection_permissions` — **required
    for AMO submission** (hard upload block since 2025-11-03). Proposed
    declaration, to confirm against the categories list before submission:
    `required: ["authenticationInfo", "websiteContent"]` (Spotify token capture;
    library data sent to the hearted backend). Cannot combine `"none"` with
    other values.
  - `background`: `{ "scripts": ["background/service-worker.js"], "type": "module" }`
    (Chrome keeps `{ "service_worker": ..., "type": "module" }`; same ESM bundle)
  - **drop** `externally_connectable` (Firefox ignores it)
  - **add** the bridge content script on the hearted origins (see Phase 4)
- [ ] Root `package.json` scripts: `ext:build:firefox`, `ext:dev:firefox`,
      `ext:build:chromium`, keep `ext:store` (Chrome Web Store), add
      `ext:store:firefox` (strip localhost origins like the Chrome path)

**Verify:** both `dist/chromium` and `dist/firefox` load unpacked with no manifest
errors; popup opens in both.

---

## Phase 3 — Namespace migration (`chrome.*` → shim `browser.*`)

Apply the shim to **extension-context** scripts only. Leave
`content/intercept-token.ts` untouched — it runs in the page's MAIN world with no
extension APIs (only `window.fetch` + `CustomEvent`).

- [ ] New `extensions/src/shared/browser.ts`:
      `export const browser: typeof chrome = (globalThis as any).browser ?? chrome`
      (no dependency added; `@types/chrome` stays)
- [ ] Import the shim and swap `chrome.` → `browser.` in:
      `background/service-worker.ts`, `background/command-handler.ts`,
      `background/expect-login-return.ts`, `background/artist-image-hydration.ts`,
      `content/spotify-token.ts`, `content/return-banner.ts`, `popup/App.tsx`,
      `shared/storage.ts`, `shared/hash-registry.ts`
- [ ] Type refs (`chrome.runtime.MessageSender`, `chrome.tabs.Tab`) are unchanged
      — they're ambient types, valid for both runtimes through the shim
- [ ] Drop the manual `new Promise(resolve => chrome.storage.local.set(p, resolve))`
      wrappers (e.g. service-worker CONNECT handler at `service-worker.ts:696`) —
      both runtimes are promise-native when the callback is omitted
- [ ] `__tests__` mocks: keep mocking the global `chrome`; the shim picks it up.
      One caveat — the shim captures the global at **module-eval time**, so mocks
      must be installed before the module under test is imported (vitest
      `vi.stubGlobal` in a setup file, as today)

**Verify:** `bun run --cwd extensions test` green; Chrome build still works
end-to-end (pure namespace indirection there).

---

## Phase 4 — The bridge (core work: replace `externally_connectable`)

The seven external channels (all verified in `service-worker.ts:679`'s
`onMessageExternal` handler): `PING`, `CONNECT`, `TRIGGER_SYNC`,
`EXPECT_LOGIN_RETURN`, `SPOTIFY_STATUS`, `GET_STATUS`, `SPOTIFY_COMMAND`.

### 4a. Extension side — one dispatcher, two front doors

- [ ] Extract the `onMessageExternal` body (`service-worker.ts:679`) into a shared
      `handleExternalCommand(message, sender)` returning a response (or void)
- [ ] Chrome: `runtime.onMessageExternal` → `handleExternalCommand`
- [ ] Firefox: `runtime.onMessage` (from the bridge content script) →
      `handleExternalCommand`. Discriminate bridge messages by a namespaced
      envelope so they don't collide with internal content-script messages
      (`SPOTIFY_TOKEN`, `PATHFINDER_HASH`, `ARM_TOKEN_PRESENT`)
- [ ] New `src/content/app-bridge.ts` (Firefox-only content script, **isolated**
      world, declared in `manifest.firefox.json` matching the hearted origins,
      `run_at: document_start`):
  - Relay page `window.postMessage` (request) → `browser.runtime.sendMessage` →
    post the response back via `window.postMessage`
  - **Security (must mirror what `externally_connectable` gave for free):**
    - `event.source === window` (reject iframes/other frames)
    - `event.origin` ∈ allowlist (same origins as the manifest `matches`:
      `hearted.music`, `*.hearted.music`, `localhost`, `127.0.0.1`)
    - namespaced message tag + per-request `id`; ignore malformed shapes
    - establish a per-load nonce in the READY handshake; require it on requests
  - Post a `HEARTED_BRIDGE_READY` message on load so the page can resolve
    detection without a fixed timeout race
- [ ] `manifest.firefox.json`: add the bridge to `content_scripts`

### 4b. Web-app side — transparent transport

- [ ] New `src/lib/extension/transport.ts`: a `sendExtensionCommand`-shaped
      function that picks a path at runtime:
  - **Chrome path** (existing): `chrome.runtime.sendMessage(EXTENSION_ID, …)`.
    On Firefox web pages `window.chrome` is undefined, so this fast-fails.
  - **Firefox path**: `window.postMessage` request + await matching `id` response,
    with a timeout (~1s) and the READY handshake for detection
- [ ] Refactor `src/lib/extension/detect.ts` (`isExtensionInstalled`,
      `getExtensionStatus`, `getSpotifyConnectionStatus`, `requestExtensionSync`,
      `triggerExtensionSync`, `connectExtension`, `expectLoginReturn`) to go
      through `transport.ts`. Public signatures unchanged → `connect.ts`,
      `useExtensionSyncStatus.ts`, onboarding/dashboard callers untouched.
- [ ] Detection semantics: Chrome = immediate `lastError` on absence; Firefox =
      resolve `false` after timeout. Both return `Promise<boolean>` as today.

**Verify (Firefox):** open hearted.music → extension detected → "Connect" pairs
(API token reaches background via `CONNECT`) → open spotify.com → trigger sync →
liked songs land in the DB. Repeat the full onboarding flow.

> Note: the Firefox detection/messaging path does **not** need
> `VITE_CHROME_EXTENSION_ID` (the bridge content script is already injected; there
> is no ID to target). The `gecko.id` in the manifest is only for the extension's
> own identity / AMO.

---

## Phase 5 — Login-return / arm-token flow under the bridge

`EXPECT_LOGIN_RETURN` reads `sender.tab.id` / `sender.tab.windowId` to scope the
post-login focus-return. Under the bridge the sender is the **bridge content
script running in the hearted tab**, so `sender.tab` is populated identically —
parity holds, arguably cleaner than the `externally_connectable` sender.

- [ ] Confirm `handleExternalCommand` reads `sender.tab` consistently for both
      front doors
- [ ] `src/content/spotify-token.ts` arm-token reporting + `reconnect-link.ts`
      arming are origin-agnostic — no change expected; verify on Firefox
- [ ] Test: arm via `SpotifyReconnectLink` → log in on Spotify → focus returns to
      the hearted tab/window

---

## Phase 6 — Write-through (`SPOTIFY_COMMAND`) parity

The playlist mutation path (`src/lib/extension/spotify-client.ts`,
`playlist-write-acknowledgement.ts`, `playlist-description-save.ts` →
`SPOTIFY_COMMAND` → `command-handler.ts` → `shared/spotify-client/*`).

- [ ] Confirm `SPOTIFY_COMMAND` round-trips through the bridge (request/response
      with `commandId` echo + normalized envelope)
- [ ] Test: from hearted UI, add a track to a playlist → appears in Spotify;
      save a playlist description → acknowledged

---

## Phase 7 — Tests

- [ ] Extension unit tests: keep the global-`chrome` mock; add a small assertion
      that the shim resolves it (no polyfill mock needed anymore)
- [ ] New `app-bridge` tests: origin allow/deny, `event.source` rejection, nonce
      enforcement, malformed-shape rejection, request/response `id` matching
- [ ] New web-app `transport.ts` tests: Chrome-path vs Firefox-path selection,
      timeout-based detection, response correlation
- [ ] Keep `live-contract.test.ts` (Spotify shape) — browser-agnostic, unchanged
- [ ] CI already filters on `extensions/**` (done in Phase 0); confirm the test
      job runs for both targets' build scripts if it builds

---

## Phase 8 — Packaging & distribution

- [ ] `bunx web-ext lint --source-dir dist/firefox` clean (web-ext is at v10.x;
      with `strict_min_version: "140.0"` set, lint also flags any API not
      available at that floor)
- [ ] `ext:store:firefox` build (localhost origins stripped)
- [ ] **Source-code submission package** (AMO policy since 2025-08-04: any
      bundled/minified output requires reviewable source + build instructions
      reproducing the exact artifact). Prepare: repo snapshot of `extensions/`,
      `bun install && bun run ext:store:firefox` instructions, pinned bun +
      esbuild versions. Dependencies must come from npm only — already true.
- [ ] Confirm the `data_collection_permissions` categories against what we
      actually transmit (token = `authenticationInfo`; library data to the
      hearted backend = likely `websiteContent`); the AMO listing + privacy
      policy must tell the same story
- [ ] AMO listing (separate from Chrome Web Store): submit via
      `web-ext sign --channel listed`, or fall back to `--channel unlisted`
      (self-distributed signed XPI — automated review only by default, same
      policies apply)
- [ ] Firefox variant of `STORE-LISTING.md`
- [ ] **Risk to surface in review notes:** the extension reverse-engineers
      Spotify's internal/Pathfinder API. There's no per-se AMO ban on using a
      third party's private API with the user's own session — the standard is
      disclosure + consent + data minimization ("no surprises", §6.1/§6.2.2.1).
      Prepare a clear data-use justification; the Aug-2025 policy update added an
      implicit-consent carveout for single-purpose extensions whose data use is
      self-evident from the name/description, which is exactly our shape.

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| MAIN-world `document_start` ordering on Firefox is **undocumented** (no guarantee it precedes page scripts) | High | **Phase 1 spike gates the whole effort**; fallbacks listed there |
| Bridge lets a hostile in-page script forge `CONNECT`/read responses | Med | origin allowlist + `source===window` + nonce + iframe reject (Phase 4a) |
| AMO rejects reverse-engineered Spotify access | Med | disclosure-first review notes; unlisted-channel self-distribution fallback |
| `data_collection_permissions` categories judged wrong at review | Low-Med | confirm category mapping pre-submission; align listing + privacy policy |
| Detection race (page posts before bridge ready) | Low | READY handshake + timeout (Phase 4) |
| Background event-page lifetime differs from SW | Low | already storage-backed; no SW-only globals; no `alarms` in use today |
| Mixed `chrome.*`/`browser.*` drift after migration | Low | shim is the single import point; lint/grep for stray `chrome.` in extension contexts |

Resolved since the last revision: the `await chrome.storage.*`-on-Firefox hazard
(moot — Firefox code path now uses native `browser.*` via the shim) and the
module-event-page uncertainty (Firefox 112+ supports `"type": "module"`; no IIFE
build needed).

---

## File-by-file change map

| File | Phase | Change |
|---|---|---|
| `extension/` → `extensions/` | 0 ✅ | `git mv` (commit `8ee54ab`) |
| `package.json` (root) | 0 ✅, 2 | per-target scripts |
| `scripts/spotify-hash-sync/sync.ts` | 0 ✅ | import path fixed |
| `.github/workflows/main.yml` | 0 ✅ | paths-filter updated |
| `extensions/scripts/build.ts` | 2 | `--target`, dual manifest copy |
| `extensions/src/manifest.chromium.json` (was `manifest.json`) | 2 | split |
| `extensions/src/manifest.firefox.json` | 2, 4 | new: gecko id, min ver 140, data_collection_permissions, bg scripts+module, bridge, no externally_connectable |
| `extensions/src/shared/browser.ts` | 3 | **new** one-line namespace shim |
| `extensions/src/background/*.ts` | 3, 4 | shim swap; extract `handleExternalCommand`; FF `onMessage` front door |
| `extensions/src/content/spotify-token.ts`, `return-banner.ts` | 3 | shim swap |
| `extensions/src/content/intercept-token.ts` | — | **unchanged** (MAIN world, no ext APIs) |
| `extensions/src/content/app-bridge.ts` | 4a | **new** Firefox bridge content script |
| `extensions/src/popup/App.tsx`, `shared/storage.ts`, `shared/hash-registry.ts` | 3 | shim swap |
| `src/lib/extension/transport.ts` | 4b | **new** transparent transport |
| `src/lib/extension/detect.ts` | 4b | route through transport |
| `extensions/src/**/__tests__/*` | 3, 7 | bridge/transport tests (chrome global mock kept) |

---

## Commit sequence

1. ~~`refactor(ext): rename extension/ → extensions/`~~ ✅ landed as `8ee54ab`
2. `chore(ext): firefox spike — MAIN-world token capture` (Phase 1, may be dropped/squashed)
3. `build(ext): dual chromium/firefox targets + manifests` (Phase 2)
4. `refactor(ext): browser.* namespace shim` (Phase 3)
5. `feat(ext): firefox app bridge + transparent web-app transport` (Phase 4)
6. `test(ext): bridge + transport coverage` (Phase 7)
7. `chore(ext): firefox packaging + AMO` (Phase 8)

---

## Implementation log (decisions & deviations, 2026-06-10)

Everything compiles and all suites are green: `extensions` 96 tests + `bunx tsc`
clean; web `bun run typecheck` exit 0 + `src/lib/extension` 92 tests; `bunx
web-ext lint extensions/dist/firefox` → **0 errors** (4 non-blocking warnings,
explained in `extensions/AMO-SUBMISSION.md`). Decisions taken beyond the plan:

1. **Shim is a lazy-resolving `Proxy`, not the literal snapshot one-liner.** The
   plan's `export const browser = globalThis.browser ?? chrome` captures the
   global at module-eval time. Two existing suites break that: `command-
   routing.test.ts` sets `globalThis.chrome` in the module body *after* imports,
   and `expect-login-return.test.ts` *reassigns* it per-test in `beforeEach`. A
   snapshot binds `undefined` and never sees those. `shared/browser.ts` is a
   Proxy that re-reads `globalThis.browser ?? globalThis.chrome` on every access
   (still typed `typeof chrome`). Covered by `shared/__tests__/browser.test.ts`.
2. **Popup converted from callback-style to promise-style `sendMessage`.**
   Firefox's `browser.runtime.sendMessage` is promise-native and ignores the
   Chrome callback arg, so the old `App.tsx` would never resolve on Firefox.
   Promise style is correct on both (Chrome MV3 is also promise-native).
3. **Root `tsconfig.json` exclude fixed `"extension"` → `"extensions"`** — a
   stale Phase-0 leftover. With the rename, the root typecheck had (already,
   before this work) started compiling `extensions/**` without `@types/chrome`,
   erroring on untouched files like `intercept-token.ts`. The extension keeps
   its own typecheck via `bunx tsc` in `extensions/`.
4. **Bridge protocol lives in top-level `shared/extension-bridge-protocol.ts`**
   (not under `extensions/`), since the web-app transport, the bridge content
   script, and the background all import it — mirroring the existing
   `shared/extension-sync-contract.ts` cross-cutting contract.
5. **HELLO→READY handshake to bootstrap the nonce and beat the detection race.**
   The plan said "post READY on load", but a `document_start` bridge posts READY
   before the page's React app has a listener. The page sends HELLO when ready;
   the bridge answers READY (carrying the per-load nonce the plan requires on
   requests), and still posts an unsolicited READY on load for already-listening
   SPA navigations.
6. **Per-command bridge timeout is a 5-min leak-guard; detection rides the 1s
   READY handshake.** On Chrome, `TRIGGER_SYNC` blocks `runtime.sendMessage` for
   the *entire* sync with no timeout. A tight per-command timeout would abort a
   legitimately long Firefox sync and falsely report "unreachable". Since the
   handshake already proves the extension is installed, the command timeout only
   guards against a silently-dead background.
7. **`app-bridge` behavioural test placed in the `extensions` suite (node + a
   tiny fake `window`), not the web suite.** A web-app test importing the
   extension source dragged extension files into the web typecheck (no chrome
   types, stricter implicit-any). Keeping it in `extensions` preserves the
   package boundary and needs no jsdom dependency.
8. **Chromium build output moved `dist/` → `dist/chromium/`** per the dual-target
   layout. Dev load-unpacked path changes accordingly (Firefox: `dist/firefox`).
9. **`gecko.id` = `hearted@hearted.music`**, `strict_min_version` kept at
   **140** despite web-ext's Android-only warning (`data_collection_permissions`
   enforcement on Firefox-for-Android needs 142). Desktop/ESR is the target per
   the plan; bump to 142 only if Android distribution is later wanted.
10. **`data_collection_permissions.required = ["authenticationInfo",
    "websiteContent"]`** — both confirmed against the official Extension Workshop
    required-value list before writing the manifest.

### Still requires a manual run (cannot be done headlessly here)
- **Phase 1 spike**: `bunx web-ext run --source-dir extensions/dist/firefox
  --target=firefox-desktop`, log into open.spotify.com, confirm the MAIN-world
  interceptor fires before Spotify's app code (token + ≥1 `PATHFINDER_HASH`
  captured across reloads). This gates real-world viability; the fallbacks in
  Phase 1 stand if ordering is flaky.
- **Every in-Firefox "Verify" step** (Phases 2/4/5/6): load unpacked, run the
  onboarding/connect/sync/login-return/playlist-write flows on Firefox.
- **AMO submission** (Phase 8): source-package upload, listing, signing — see
  `extensions/AMO-SUBMISSION.md`.
