# Tasks: Align v2 Schema

## 1. Rewrite Migrations
- [x] 1.1 Update `song` columns (isrc, artists TEXT[], image_url, popularity, preview_url)
- [x] 1.2 Update `liked_song` soft delete + status columns and indexes
- [x] 1.3 Update `playlist` song_count + is_destination in base migration
- [x] 1.4 Expand `job_type` values for analysis + matching
- [x] 1.5 Update analysis tables (model, prompt_version, tokens_used, cost_cents; remove UNIQUE)
- [x] 1.6 Update embedding/profile tables (kind, dims, content_hash, hashes, song_ids)
- [x] 1.7 Update match_context fields (config + set hashes)
- [x] 1.8 Update job_failure + item_status enums/columns to match docs
- [x] 1.9 Update user_preferences onboarding_step to TEXT
- [x] 1.10 Make `add_playlist_is_destination` migration safe/no-op after rewrite

## 2. Update Data Layer
- [x] 2.1 Update data modules to reflect new column names/types
- [x] 2.2 Regenerate database types (`bun run gen:types`)

## 3. Update Docs
- [x] 3.1 Update `docs/migration_v2/01-SCHEMA.md` (already aligned)
- [x] 3.2 Update `docs/migration_v2/03-IMPLEMENTATION.md`
- [x] 3.3 Update `docs/migration_v2/ROADMAP.md`
- [x] 3.4 Update `docs/migration_v2/00-DECISIONS.md` (already aligned)
