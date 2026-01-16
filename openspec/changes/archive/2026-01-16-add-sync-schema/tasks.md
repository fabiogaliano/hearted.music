# Tasks: Add core schema + sync checkpoint strategy (Phase 0)

## 1. Schema
- [x] 1.1 Create migrations for `song`, `playlist`, `liked_song`, `playlist_song` with v2 constraints
- [x] 1.2 Define sync checkpoint storage in `job.progress` for liked songs + playlists
- [x] 1.3 Add/adjust RLS policies for these tables
- [x] 1.4 Regenerate Supabase types (`bun run gen:types`)

## 2. Validation
- [x] 2.1 Run `openspec validate add-sync-schema --strict --no-interactive`
