# Tasks: Complete Phase 3 Query Modules

## 1. Analysis Module (`analysis.ts`)

- [x] 1.1 Create `src/lib/data/analysis.ts` with module header and imports
- [x] 1.2 Add type exports: `SongAnalysis`, `SongAudioFeature`, `PlaylistAnalysis`
- [x] 1.3 Implement `getSongAnalysis(songIds: string | string[])` — latest analysis for one or more songs
- [x] 1.4 Implement `insertSongAnalysis(data)` — insert new analysis
- [x] 1.5 Implement `getSongAudioFeatures(songId: string)` — audio features for song
- [x] 1.6 Implement `upsertSongAudioFeatures(features[])` — bulk upsert
- [x] 1.7 Implement `getPlaylistAnalysis(playlistId: string)` — latest analysis
- [x] 1.8 Implement `insertPlaylistAnalysis(data)` — insert new analysis

## 2. Vectors Module (`vectors.ts`)

- [x] 2.1 Create `src/lib/data/vectors.ts` with module header and imports
- [x] 2.2 Add type exports: `SongEmbedding`, `PlaylistProfile`
- [x] 2.3 Implement `getSongEmbedding(songId, modelName)` — get embedding for song
- [x] 2.4 Implement `upsertSongEmbedding(data)` — insert/update embedding
- [x] 2.5 Implement `getPlaylistProfile(playlistId)` — get profile
- [x] 2.6 Implement `upsertPlaylistProfile(data)` — insert/update profile

## 3. Matching Module (`matching.ts`)

- [x] 3.1 Create `src/lib/data/matching.ts` with module header and imports
- [x] 3.2 Add type exports: `MatchContext`, `MatchResult`
- [x] 3.3 Implement `getMatchContext(contextId: string)` — fetch by ID
- [x] 3.4 Implement `createMatchContext(data)` — create new context
- [x] 3.5 Implement `getMatchResults(contextId: string)` — all results for context
- [x] 3.6 Implement `getMatchResultsForSong(contextId, songId)` — results for specific song
- [x] 3.7 Implement `insertMatchResults(results[])` — bulk insert results
- [x] 3.8 Implement `getTopMatchesPerPlaylist(contextId, limit)` — aggregated top matches

## 4. Newness Module (`newness.ts`)

- [x] 4.1 Create `src/lib/data/newness.ts` with module header and imports
- [x] 4.2 Add type exports: `ItemStatus`, `ItemType`
- [x] 4.3 Implement `getNewCounts(accountId)` — counts per item type
- [x] 4.4 Implement `getNewItemIds(accountId, itemType)` — IDs of new items
- [x] 4.5 Implement `markItemsNew(accountId, itemType, itemIds[])` — bulk mark new
- [x] 4.6 Implement `markSeen(accountId, itemType, itemIds[])` — mark as viewed
- [x] 4.7 Implement `markAllSeen(accountId, itemType)` — clear all new for type

## 5. Preferences Module (`preferences.ts`)

- [x] 5.1 Create `src/lib/data/preferences.ts` with module header and imports
- [x] 5.2 Add type exports: `UserPreferences`, `ThemeColor`, `OnboardingStep`
- [x] 5.3 Implement `getPreferences(accountId: string)` — fetch or create preferences
- [x] 5.4 Implement `updateTheme(accountId, theme)` — set theme
- [x] 5.5 Implement `getOnboardingStep(accountId)` — current step
- [x] 5.6 Implement `updateOnboardingStep(accountId, step)` — advance step
- [x] 5.7 Implement `completeOnboarding(accountId)` — mark complete

## 6. Validation & Documentation

- [x] 6.1 Run `bun run typecheck` — ensure all modules compile
- [x] 6.2 Update `docs/migration_v2/03-IMPLEMENTATION.md` — mark Phase 3 complete
- [x] 6.3 Update `docs/migration_v2/ROADMAP.md` — update status
