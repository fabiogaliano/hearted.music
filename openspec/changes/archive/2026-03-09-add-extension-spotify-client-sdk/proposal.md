## Why

Spotify’s public SDK path is no longer viable for hearted’s user-scoped operations, and we now depend on reverse-engineered Pathfinder + Playlist v2 APIs that must run inside the Chrome extension context. The current server-side artist-image path also depends on official app-auth Spotify endpoints that are being deprecated, so artist-image retrieval must move to extension-executed internal APIs as part of this change.

## What Changes

- Add an extension-local Spotify client library that centralizes all reverse-engineered Spotify operations (reads + writes) behind typed methods.
- Define a stable app↔extension command contract for invoking Spotify operations through `externally_connectable` messaging.
- Add a service-worker command router that maps commands to client methods, with shared retry/rate-limit behavior.
- Add a browser-only app-side proxy module with SDK-like method signatures that delegates execution to the extension.
- Include artist-image support in v1 by implementing `queryArtistOverview` (or documented internal equivalent) in the extension client and routing artist image lookups through browser→extension commands.
- Add a write outcome flow: client sends extension command, extension executes, client posts success/failure to server for DB state updates.
- Add operation-level result envelopes and error codes so backend/UI orchestration can handle failures deterministically.
- Document full request/response object shapes for supported internal endpoints before DTO mapping.
- Define v1 batching strategy: use native multi-item request payloads when proven (for example `playlistItemUris`), otherwise execute sequentially with pacing.
- Add on-demand live contract tests (not default CI) to verify API response compatibility and parser/type assumptions against real Spotify responses.
- **BREAKING**: User-scoped Spotify writes (create playlist, add/remove tracks, update/delete playlist) are no longer initiated from server-side Spotify SDK integration; they must execute from browser context through the extension bridge.
- **BREAKING**: Server functions that previously represented direct Spotify writes become DB-acknowledgement endpoints invoked after extension command results.
- **BREAKING**: Artist-image enrichment no longer relies on server app-auth Spotify API calls as the primary source; it must flow through extension-executed internal API commands.

## Capabilities

### New Capabilities
- `extension-spotify-client`: Defines the extension-resident SDK layer, method contracts, and command execution semantics for Spotify internal APIs.

### Modified Capabilities
- `extension-data-pipeline`: Extends requirements from sync-only ingestion to include command-based Spotify write execution and app↔extension command/result flows.

## Impact

### Affected specs
- `extension-spotify-client` (new)
- `extension-data-pipeline` (modified)

### Affected code
- `extension/src/shared/pathfinder.ts`
- `extension/src/shared/types.ts`
- `extension/src/background/service-worker.ts`
- `extension/src/shared/*` (new spotify-client modules)
- `src/lib/extension/detect.ts`
- `src/lib/server/*.ts` and write orchestration call sites currently assuming direct Spotify SDK writes
- `src/lib/server/liked-songs.functions.ts` (write flow split: browser command + server DB acknowledgement)
- `src/routes/api/artist-images-for-tracks.tsx` and artist-image callers currently depending on app-auth Spotify API

### Dependencies / systems
- No new external dependencies required
- Continues using extension token/hash interception and persisted query hash registry
- Requires consistent message contract between web app and extension service worker
