# Change: Complete Phase 3 Query Modules

## Why

Phase 3 of the migration requires finishing the remaining data access modules called out in the roadmap and implementation plan (`analysis.ts`, `vectors.ts`, `matching.ts`, `newness.ts`, `preferences.ts`). Core query modules already exist (`songs.ts`, `playlists.ts`, `jobs.ts`, `accounts.ts`), along with shared helpers (`client.ts`, `auth-tokens.ts`), but the missing modules block Phase 4 service consolidation and UI integration.

## What Changes

Add the remaining query modules following the established `Result<T, DbError>` pattern:

1. **`analysis.ts`** — Song and playlist LLM analysis access
   - `song_analysis`, `song_audio_feature`, `playlist_analysis` queries
   - Functions: `getSongAnalysis` (latest, single or batch), `insertSongAnalysis`, `getSongAudioFeatures`, `upsertSongAudioFeatures`, `getPlaylistAnalysis`, `insertPlaylistAnalysis`

2. **`vectors.ts`** — Embeddings and profile operations
   - `song_embedding`, `playlist_profile` queries
   - Functions: `getSongEmbedding`, `upsertSongEmbedding`, `getPlaylistProfile`, `upsertPlaylistProfile`

3. **`matching.ts`** — Match context and results
   - `match_context`, `match_result` operations with aggregation queries
   - Functions: `getMatchContext`, `createMatchContext`, `getMatchResults`, `getMatchResultsForSong`, `insertMatchResults`, `getTopMatchesPerPlaylist`

4. **`newness.ts`** — Item status tracking
   - `item_status` queries for newness counts and seen state
   - Functions: `getNewCounts`, `getNewItemIds`, `markItemsNew`, `markSeen`, `markAllSeen`

5. **`preferences.ts`** — User preferences
   - `user_preferences` queries for theme + onboarding progress
   - Functions: `getPreferences`, `updateTheme`, `getOnboardingStep`, `updateOnboardingStep`, `completeOnboarding`

## Impact

- **Affected specs**: `migration-v2`
- **Affected code**: `src/lib/data/` (new files)
- **Blocks**: Phase 4a-4d (service consolidation), Phase 5 (SSE), Phase 7 (UI)
- **Dependencies**: Phase 2 complete (types generated), existing query modules for pattern reference
