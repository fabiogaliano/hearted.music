## 1. Consolidate Base Schema Migrations

- [x] 1.1 Fold `image_url TEXT` column into `20260116160001_create_playlist.sql` and delete `20260123225535_add_image_url_to_playlist.sql`
- [x] 1.2 Delete NO-OP migration `20260117030516_add_playlist_is_destination.sql` (`SELECT 1`)
- [x] 1.3 Fold `artist_ids TEXT[] NOT NULL DEFAULT '{}'` column into `20260116160000_create_song.sql` and delete `20260202133536_add_artist_ids_to_song.sql`
- [x] 1.4 Remove `status TEXT` column from `20260116160002_create_liked_song.sql` (sorting status moves to item_status)
- [x] 1.5 Fold `sync_playlist_tracks` value into `job_type` enum in `20260116160004_create_job.sql` and delete `20260125000000_add_sync_playlist_tracks_job_type.sql`
- [x] 1.6 Fold `phase_job_ids JSONB` column and nullable `theme` into `20260117000011_create_user_preferences.sql` and delete `20260123000000_add_current_job_id_to_user_preferences.sql` and `20260124012600_make_theme_nullable.sql`
- [x] 1.7 Fold RLS policy into `20260123100000_create_app_token.sql` and delete `20260124074456_add_app_token_rls_policy.sql`

## 2. Fix and Consolidate SQL Functions

- [x] 2.1 Merge `get_liked_songs_page` into single migration `20260202082559_add_liked_songs_page_function.sql`: replace bare LEFT JOIN with LEFT JOIN LATERAL for song_analysis, replace `ls.status` filter with `item_status` JOIN, add `sorting_status TEXT` to return columns, and delete `20260202133656_update_liked_songs_page_function.sql`
- [x] 2.2 Fix `get_liked_songs_stats` in `20260202204006_add_liked_songs_stats_function.sql`: replace `ls.status` counts with LEFT JOIN on `item_status` for accurate sorted/unsorted counts

## 3. Update Server Code

- [x] 3.1 Update `src/lib/server/liked-songs.server.ts` mapping to read `sorting_status` from the new RPC return column instead of casting `row.status`
- [x] 3.2 Update `src/lib/data/liked-song.ts` types if needed (remove references to `liked_song.status`)

## 4. Regenerate Types and Validate

- [x] 4.1 Run `supabase db reset --local` to apply consolidated migrations
- [x] 4.2 Regenerate `database.types.ts` from local schema
- [x] 4.3 Run TypeScript type check (`bunx tsc --noEmit`) and fix any type errors
- [x] 4.4 Run tests (`bun run test`) and fix any failures
