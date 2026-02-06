## Why

Code review revealed two bugs in SQL functions (`get_liked_songs_page` duplicate rows, `get_liked_songs_stats` counting wrong column) and a design drift where `liked_song.status` is never written to while `item_status` already tracks all user sorting actions. Since we're pre-production, this is the right time to consolidate migrations (8 files that modify earlier ones can be folded back), fix the SQL bugs, and establish `item_status` as the single source of truth for sorting status.

## What Changes

- **BREAKING**: Remove `liked_song.status` column — sorting status is derived from `item_status` records instead
- Fix `get_liked_songs_page`: replace `LEFT JOIN song_analysis` with `LEFT JOIN LATERAL` subquery to prevent duplicate rows when a song has multiple analyses
- Fix `get_liked_songs_page`: replace `ls.status` filter logic with `item_status` JOIN (`sorted` = has actioned item_status, `unsorted` = no item_status record)
- Fix `get_liked_songs_stats`: replace `ls.status` counts with `item_status` JOIN for accurate sorted/unsorted counts
- Consolidate 8 migration files by folding later modifications back into their original migrations:
  - `playlist`: fold `image_url` column into create migration, delete NO-OP migration
  - `user_preferences`: fold `phase_job_ids` column and nullable `theme` into create migration
  - `app_token`: fold RLS policy into create migration
  - `song`: fold `artist_ids` column into create migration
  - `get_liked_songs_page`: merge v1 and v2 into single migration with LATERAL fix
  - `job_type` enum: fold `sync_playlist_tracks` value into create migration
- Update server-side mapping in `liked-songs.server.ts` to derive `sorting_status` from `item_status` JOIN instead of `liked_song.status`

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `migration-v2`: Remove `liked_song.status` column from schema. Sorting status is no longer stored on `liked_song` — it is derived from `item_status` presence/absence.
- `newness`: Expand `item_status` responsibility from newness-only to also being the source of truth for sorting status. A song is "sorted" when it has an `item_status` record with `actioned_at IS NOT NULL`.

## Impact

- **SQL migrations**: 33 files → 25 files (8 removed via consolidation). Requires `supabase db reset --local` after changes.
- **SQL functions**: `get_liked_songs_page` and `get_liked_songs_stats` signatures unchanged, but internal queries change (new JOIN on `item_status`).
- **Server code**: `liked-songs.server.ts` mapping must handle new `item_status` columns from RPC return.
- **TypeScript types**: `database.types.ts` will need regeneration after migration changes.
- **No frontend changes**: `LikedSongsPage` already consumes `sorting_status` from the server — the source just changes.
