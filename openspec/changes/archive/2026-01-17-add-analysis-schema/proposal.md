# Change: Add Analysis Schema Tables

## Why

Phase 1 (Schema) is incomplete. The following tables are missing and block the analysis pipeline (Phase 4b) and matching features:

- `song_audio_feature` - Spotify audio features (tempo, energy, etc.)
- `song_analysis` - LLM analysis results (mood, themes, etc.)
- `song_embedding` - Vector embeddings for similarity search
- `song_genre` - Genre classifications
- `playlist_analysis` - Playlist-level LLM analysis
- `playlist_profile` - Playlist vector profiles for matching
- `job_failure` - Failed item tracking within jobs
- `match_context` - Configuration snapshot for match reproducibility
- `match_result` - Song-to-playlist match scores
- `item_status` - Newness tracking
- `user_preferences` - Theme and onboarding state

## What Changes

- Add 11 new SQL migration files to `supabase/migrations/`
- Enable pgvector extension (if not already)
- Add RLS policies for each table
- Regenerate TypeScript types

## Impact

- Affected specs: `migration-v2` (Schema requirements)
- Affected code: `supabase/migrations/`, `src/lib/data/database.types.ts`
- Enables: Phase 3 remaining query modules, Phase 4b analysis pipeline, Phase 5 matching
