# Change: Add core schema + sync checkpoint strategy (Phase 0)

## Why
We need a concrete schema baseline and sync checkpoint strategy before Result refactors can map Spotify data into the v2 tables.

## What Changes
- Define core Spotify tables (`song`, `playlist`, `liked_song`, `playlist_song`) and their key constraints.
- Define how sync checkpoints are stored in `job.progress` for incremental sync (liked songs + playlists).

## Impact
- **Affected specs**: migration-v2
- **Affected code**:
  - `supabase/migrations/*`
  - `src/lib/data/database.types.ts`
