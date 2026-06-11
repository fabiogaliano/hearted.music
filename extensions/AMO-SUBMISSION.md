# Firefox (AMO) submission notes

Companion to `STORE-LISTING-FIREFOX.md` (the AMO listing copy). This file
captures the Firefox/AMO-specific build mechanics: source-code submission, the
data-collection declaration, and the reviewer disclosure for the Spotify
private-API usage.

## Environment requirements

- Operating system: any OS that runs bun. The submitted artifact was built on
  macOS (Darwin 24.6.0, arm64); the build is OS-independent (pure esbuild
  bundling, no native compilation).
- bun `1.2.23` — the only program required. Install per the official docs:
  `curl -fsSL https://bun.sh/install | bash` (macOS/Linux) or
  `powershell -c "irm bun.sh/install.ps1 | iex"` (Windows). See https://bun.sh.
- node/npm are **not** required to build. (node v23.11.0 was present on the
  build machine but is unused — bun runs `scripts/build.ts` directly and
  installs all dependencies.)
- No network access is needed at build time beyond `bun install`, which
  resolves the exact dependency versions pinned in `extensions/bun.lock`.

## Build

```sh
# from extensions/ (where these scripts are defined)
bun install                   # resolves exact versions from bun.lock
bun run ext:store:firefox     # → extensions/dist/firefox (localhost origins stripped, minified)
bun run ext:lint:firefox      # web-ext lint; exits 0 (only the expected warnings below)
```

The uploaded XPI is `extensions/dist/firefox` packaged as a zip. `ext:store:firefox`
is the build script that performs every technical step (manifest selection,
localhost stripping, esbuild bundle + minify, asset copy).

Pinned toolchain (the exact versions used for the submitted artifact):

- bun `1.2.23`
- esbuild `0.25.12` (declared `^0.25.0` in `extensions/package.json`, locked in `bun.lock`)
- web-ext `10.3.0` (declared `^10.3.0` in `extensions/package.json`, locked in `bun.lock`)

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

`bun run ext:lint:firefox` exits 0 with four non-blocking warnings, all
expected:

- three `UNSAFE_VAR_ASSIGNMENT` (innerHTML) — these come from React 19's DOM
  runtime bundled into `dist/firefox/popup/main.js`, not our code. Our own
  content scripts build DOM with `createElement`/`textContent`/`appendChild`
  only.
- one `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` — the Android
  `data_collection_permissions` floor, explained under "Minimum version" below.

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

The extension reads Spotify's internal Pathfinder/GraphQL API with the user's
own session. The policy does not address third-party private APIs directly; the
standard is disclosure + consent (Section 1 "No Surprises"; Section 6). We rely
on §6.2.2.2 "Implicit Consent for Self-Evident, Single-Use Extension": data is
transmitted only when the user connects and triggers a sync.

Consent is explicit: before any transmission, the hearted. web app shows a
disclosure ("here's what hearted can see": profile, liked songs, playlists) and
an "allow sync" button. This also covers §6.2.2.1 "Personal Data (opt-in)" if a
reviewer reads `authenticationInfo` as personal data.

## Distribution

- Preferred: `web-ext sign --channel listed` (public AMO listing).
- Fallback: `--channel unlisted` (self-distributed signed XPI; automated review
  only by default, same policies apply).
