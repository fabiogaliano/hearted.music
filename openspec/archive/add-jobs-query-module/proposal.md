# Change: Add Jobs + Playlists Query Modules

## Why

The data layer needs `jobs.ts` and `playlists.ts` query modules to handle the unified job system and playlist operations. This enables playlist sync and destination selection alongside job progress reporting, which is the foundation for SSE real-time updates.

## What Changes

- Add `src/lib/data/playlists.ts` with typed functions for:
  - Playlist CRUD (get by ID, get all for account, upsert, delete)
  - Destination playlist queries (get flagged playlists)
  - Playlist-song junction operations (get songs, upsert, remove)
- Add `src/lib/data/jobs.ts` with typed functions for:
  - Job CRUD (create, get by ID, get active for account)
  - Status transitions (mark running, completed, failed)
  - Progress updates (update JSONB progress field)
  - Checkpoint queries (get latest checkpoint for sync resumption)
- Export domain types (`Playlist`, `PlaylistSong`, `Job`, `JobProgress`, insert types)
- All functions return `Result<T, DbError>` for composable error handling

## Impact

- Affected specs: `migration-v2` (Query Modules, Unified Job System, Sync Checkpoint Tracking)
- Affected code: `src/lib/data/playlists.ts`, `src/lib/data/jobs.ts`
- Enables: Playlist sync service, destination selection, sync orchestrator, SSE progress streaming, analysis pipeline
