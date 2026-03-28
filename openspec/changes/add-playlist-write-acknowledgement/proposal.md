## Why

The app can already execute playlist-level Spotify writes from the browser through the extension (`createPlaylist`, `updatePlaylist`, `deletePlaylist`), but the inspected app-side persistence path for playlists still primarily runs through extension sync (`src/routes/api/extension/sync.tsx` and `src/lib/workflows/spotify-sync/playlist-sync.ts`). That means successful playlist writes can leave app DB state and UI state stale until a later sync, which is a poor foundation for a real `/playlists` management route.

## What Changes

- Add a focused playlist-level write acknowledgement flow so confirmed extension write outcomes are persisted to app DB state immediately after browser-side command success.
- Scope this change to playlist-level writes only:
  - create playlist
  - update playlist metadata (`name`, `description`)
  - delete playlist
- Keep the extension as the only Spotify write executor. The server acknowledgement layer SHALL persist confirmed outcomes to the app database, but SHALL NOT perform Spotify writes itself.
- Add app-side acknowledgement boundaries and playlist data helpers so:
  - successful `createPlaylist(...)` can create/upsert a `playlist` row immediately
  - successful `updatePlaylist(...)` can persist new `name` / `description` immediately
  - successful `deletePlaylist(...)` can remove the `playlist` row immediately
- Treat extension sync as reconciliation/repair after the fact, not as the primary mechanism for making playlist-level writes visible in app state.
- Explicitly keep these concerns out of scope for this change:
  - track-item add/remove acknowledgement (`addToPlaylist`, `removeFromPlaylist`)
  - delayed or coalesced downstream refresh execution for target-affecting playlist changes
  - full `/playlists` route implementation

## Capabilities

### New Capabilities
- `playlist-write-acknowledgement`: Browser-command plus server-acknowledgement flow for playlist-level Spotify writes, covering immediate app-state persistence for create, metadata update, and delete outcomes.

### Modified Capabilities
- `extension-data-pipeline`: Refine the existing write-outcome persistence contract so playlist-level extension writes are explicitly acknowledged into backend state instead of relying on later full sync to surface results.

## Affected specs

- New spec: `playlist-write-acknowledgement`
- Modified spec: `extension-data-pipeline`

## Impact

- Affected code: `src/lib/domains/library/playlists/queries.ts`, new route-facing server functions such as `src/lib/server/playlists.functions.ts`, browser-side orchestration that uses `src/lib/extension/spotify-client.ts`, and later `/playlists` consumers that need immediate playlist-state correctness.
- Affected systems: extension command execution, browser→server write acknowledgement flow, playlist table persistence, query invalidation/refetch behavior, and sync reconciliation semantics.
- Architectural impact: playlist-level Spotify writes move to a clean two-step model — extension executes the Spotify mutation, then the app server acknowledges and persists the confirmed outcome into canonical DB state.
