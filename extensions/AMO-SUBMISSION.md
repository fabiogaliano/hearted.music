# Firefox (AMO) submission notes

Companion to `STORE-LISTING-FIREFOX.md` (the AMO listing copy). This file
captures the Firefox/AMO-specific build mechanics: source-code submission, the
data-collection declaration, and the reviewer disclosure for the Spotify
private-API usage.

## Build

```sh
# from the repo root
bun install
bun run ext:store:firefox     # → extensions/dist/firefox (localhost origins stripped)
bun run ext:lint:firefox      # web-ext lint; expect 0 errors
```

Pinned toolchain (record the exact versions used for the submitted artifact):

- bun `1.2.23`
- esbuild `0.25.12` (declared `^0.25.0` in `extensions/package.json`)

The build is reproducible from source only — all dependencies come from npm,
nothing is fetched at build time, and `build.ts` runs esbuild with no codegen
beyond bundling/minification.

## Source-code submission (required since 2025-08-04)

AMO requires reviewable source for any minified/bundled output. Submit:

- a snapshot of `extensions/` (the `src/` tree + `scripts/build.ts`)
- the top-level `shared/` directory (the extension imports
  `shared/extension-sync-contract.ts`, `shared/spotify-command-protocol.ts`,
  and `shared/extension-bridge-protocol.ts`)
- these build instructions + the pinned versions above

`extensions/dist/firefox/popup/main.js` bundles React 19 — this is the source of
the three `UNSAFE_VAR_ASSIGNMENT` (innerHTML) lint warnings, which originate in
React's DOM runtime, not in our code. Our own content scripts build DOM with
`createElement`/`textContent`/`appendChild` only.

## Data collection declaration

`manifest.firefox.json` declares (hard AMO upload requirement since 2025-11-03):

```json
"data_collection_permissions": { "required": ["authenticationInfo", "websiteContent"] }
```

- `authenticationInfo` — the extension captures the user's own Spotify access
  token (from their authenticated session on open.spotify.com) to read their
  library.
- `websiteContent` — the user's liked songs / playlists are sent to the hearted
  backend, which is the extension's sole purpose.

The AMO listing and the privacy policy must tell the same story. Both categories
are on the official required-value list (Extension Workshop, "Firefox built-in
data consent"); `"none"` cannot be combined with other values.

## Minimum version

`strict_min_version: "140.0"` — the floor for `data_collection_permissions` on
**desktop** (also the current ESR). `world: "MAIN"` content scripts (the token
interceptor) need only 128+, so 140 is the binding constraint.

`web-ext lint` emits one non-blocking warning here
(`KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`): on **Firefox for Android**,
`data_collection_permissions` enforcement only landed in 142, so a 140 floor
under-enforces it on Android 140–141. This extension targets desktop; if Android
distribution is later desired, bump the floor to `"142.0"`. (Decision: kept at
140 per the port plan's deliberate desktop/ESR choice.)

## Reviewer disclosure — Spotify private API

The extension reads Spotify's internal Pathfinder/GraphQL API using the user's
own authenticated session. There is no per-se AMO ban on using a third party's
private API with the user's own session; the standard is disclosure + consent +
data minimization ("no surprises", policy §6.1 / §6.2.2.1). Our shape — a
single-purpose extension whose data use is self-evident from the name and
description — falls under the Aug-2025 implicit-consent carve-out for
single-purpose extensions. Surface this clearly in the review notes.

## Distribution

- Preferred: `web-ext sign --channel listed` (public AMO listing).
- Fallback: `--channel unlisted` (self-distributed signed XPI; automated review
  only by default, same policies apply).
