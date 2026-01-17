# Change: Add Songs Query Module

## Why

The data layer needs a `songs.ts` module to handle song and liked song database operations. This follows the established Result-based pattern from `accounts.ts` and enables song sync functionality.

## What Changes

- Add `src/lib/data/songs.ts` with typed functions for:
  - Song CRUD (get by ID, get by Spotify ID, upsert batch)
  - Liked song operations (get user's liked songs, upsert, soft delete)
  - Status queries (pending songs, unmatched songs)
- Export domain types (`Song`, `LikedSong`, insert types)
- All functions return `Result<T, DbError>` for composable error handling

## Impact

- Affected specs: `migration-v2` (Query Modules requirement)
- Affected code: `src/lib/data/songs.ts` (new file)
- Enables: Song sync service, matching pipeline
