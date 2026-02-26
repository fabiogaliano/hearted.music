# Tasks: Redesign Analysis Pipeline

Ordered by dependency. Schema and types first, then consumers, then tests.

## 1. Analysis Schema + Prompt

- [x] 1.1 Replace `SongAnalysisLlmSchema` with `SongAnalysisLyricalSchema` (8 flat fields: `headline`, `compound_mood`, `mood_description`, `interpretation`, `themes`, `journey`, `key_lines`, `sonic_texture`) and export `SongAnalysisLyrical` type via `z.infer` in `src/lib/capabilities/analysis/song-analysis.ts`
- [x] 1.2 Add `SongAnalysisInstrumentalSchema` (4 fields: `headline`, `compound_mood`, `mood_description`, `sonic_texture`) and export `SongAnalysisInstrumental` type in `src/lib/capabilities/analysis/song-analysis.ts`
- [x] 1.3 Add union type `SongAnalysisResult = SongAnalysisLyrical | SongAnalysisInstrumental` and a type guard `isLyricalAnalysis()` in `src/lib/capabilities/analysis/song-analysis.ts`
- [x] 1.4 Rewrite `SONG_ANALYSIS_PROMPT` for lyrical songs with brand voice directives (compound moods, evocative fragments, no hedging, present-tense), add `{genres}` placeholder for Last.fm genre input context, and target the new 8-field schema in `src/lib/capabilities/analysis/song-analysis.ts`
- [x] 1.5 Add `INSTRUMENTAL_ANALYSIS_PROMPT` targeting the 4-field instrumental schema with brand voice, receiving audio features + genres + artist/title as input in `src/lib/capabilities/analysis/song-analysis.ts`
- [x] 1.6 Update `AnalyzeSongInput` to add optional `genres?: string[]` and optional `instrumentalness?: number` fields in `src/lib/capabilities/analysis/song-analysis.ts`
- [x] 1.7 Update `SongAnalysisService.analyzeSong()` to detect instrumental path (no lyrics OR `instrumentalness > 0.5` OR lyrics < 50 words) and route to `INSTRUMENTAL_ANALYSIS_PROMPT` + `SongAnalysisInstrumentalSchema` instead of returning `NoLyricsAvailableError` in `src/lib/capabilities/analysis/song-analysis.ts`
- [x] 1.8 Update `buildPrompt()` to accept genres array and inject into `{genres}` placeholder, add `buildInstrumentalPrompt()` method in `src/lib/capabilities/analysis/song-analysis.ts`
- [x] 1.9 Update `buildAnalysisData()` to handle both lyrical and instrumental output shapes (flat fields, no nested `meaning`/`emotional`/`context`/`musical_style` groups) in `src/lib/capabilities/analysis/song-analysis.ts`

## 2. Analysis Pipeline (Instrumental Routing)

- [x] 2.1 Update `AnalysisPipeline.analyzeSongs()` to pass `audioFeatures.instrumentalness` and song genres through to `SongAnalysisService.analyzeSong()` via `AnalyzeSongInput` in `src/lib/capabilities/analysis/pipeline.ts`
- [x] 2.2 Remove the early `NoLyricsAvailableError` bail-out for songs without lyrics in the pipeline loop -- let `SongAnalysisService` handle instrumental routing instead, in `src/lib/capabilities/analysis/pipeline.ts`
- [x] 2.3 Update SSE item labels to reflect instrumental vs lyrical path (e.g. "analyzing (instrumental)") in `src/lib/capabilities/analysis/pipeline.ts`

## 3. Embedding Text Builder

- [x] 3.1 Remove `EmbeddingKindSchema`, `EmbeddingKind` type, and the `switch` statement in `buildEmbeddingText()` in `src/lib/ml/embedding/service.ts`
- [x] 3.2 Remove `buildThemeText()`, `buildMoodText()`, `buildContextText()` dead code methods from `EmbeddingService` in `src/lib/ml/embedding/service.ts`
- [x] 3.3 Rewrite `buildFullText()` (rename to `buildEmbeddingText()`) to compose from new flat schema fields: `headline` + `compound_mood` + `mood_description` + `interpretation` + theme names + theme descriptions + journey moods + `sonic_texture` + genres (from Last.fm stored on song) in `src/lib/ml/embedding/service.ts`
- [x] 3.4 Handle instrumental variant in `buildEmbeddingText()`: compose from 4 fields (`headline`, `compound_mood`, `mood_description`, `sonic_texture`) + genres when lyric-dependent fields are absent in `src/lib/ml/embedding/service.ts`
- [x] 3.5 Update `embedSong()` and `embedBatch()` signatures to remove `kind` parameter, default `"full"` internally for DB column compatibility in `src/lib/ml/embedding/service.ts`
- [x] 3.6 Update `getEmbedding()` and `getEmbeddings()` to remove `kind` parameter, hardcode `"full"` in `src/lib/ml/embedding/service.ts`
- [x] 3.7 Update or remove `src/lib/ml/embedding/extractors.ts` if it contains old-schema text extraction logic (currently references `best_moments`, nested `context`, `meaning`)

## 4. Matching Types + Config

- [x] 4.1 Replace `ScoreFactors` with 3 fields (`embedding`, `audio`, `genre`) in `src/lib/capabilities/matching/types.ts`
- [x] 4.2 Replace `MatchingWeights` with 3 fields (`embedding`, `audio`, `genre`) in `src/lib/capabilities/matching/types.ts`
- [x] 4.3 Remove `MatchingSongAnalysis` interface (fields `dominantMood`, `themes`, `listeningContexts` have no consumers after this change) from `src/lib/capabilities/matching/types.ts`
- [x] 4.4 Remove `analysis` field from `MatchingSong` interface in `src/lib/capabilities/matching/types.ts`
- [x] 4.5 Simplify `MatchingPlaylistProfile`: remove `emotionDistribution`, `themes`, `listeningContexts`, `recentSongs` fields in `src/lib/capabilities/matching/types.ts`
- [x] 4.6 Simplify `DataAvailability` to 3 flags: `hasEmbedding`, `hasGenres`, `hasAudioFeatures` (remove `hasAnalysis`, `hasRecentSongs`) in `src/lib/capabilities/matching/types.ts`
- [x] 4.7 Remove `deepAnalysisThreshold` from `MatchingConfig` in `src/lib/capabilities/matching/types.ts`
- [x] 4.8 Update `DEFAULT_MATCHING_WEIGHTS` to `{ embedding: 0.50, audio: 0.30, genre: 0.20 }` in `src/lib/capabilities/matching/config.ts`
- [x] 4.9 Rewrite `computeAdaptiveWeights()` for 3 signals (proportional redistribution among `embedding`, `audio`, `genre`) in `src/lib/capabilities/matching/config.ts`
- [x] 4.10 Remove `SEMANTIC_THRESHOLDS` from `src/lib/capabilities/matching/config.ts` (no longer consumed)

## 5. Matching Scoring + Service

- [x] 5.1 Remove `GOOD_MOOD_TRANSITIONS` and `RELATED_MOODS` lookup tables from `src/lib/capabilities/matching/scoring.ts`
- [x] 5.2 Remove `scoreMoodTransition()` and `computeFlowScore()` from `src/lib/capabilities/matching/scoring.ts`
- [x] 5.3 Remove `computeContextScore()` from `src/lib/capabilities/matching/scoring.ts`
- [x] 5.4 Remove `computeThematicScore()` from `src/lib/capabilities/matching/scoring.ts`
- [x] 5.5 Delete `SemanticMatcher` class from `src/lib/capabilities/matching/semantic.ts`, keep `cosineSimilarity()` standalone function (still used by `MatchingService.computeVectorScore()`)
- [x] 5.6 Update `MatchingService.scoreSongToPlaylist()`: remove Tier 2 deep analysis gate, compute only 3 factors (`embedding`, `audio`, `genre`), build `ScoreFactors` with 3 fields in `src/lib/capabilities/matching/service.ts`
- [x] 5.7 Update `MatchingService.computeFinalScore()` for 3-field `ScoreFactors` and `MatchingWeights` in `src/lib/capabilities/matching/service.ts`
- [x] 5.8 Update confidence computation: `availableCount / 3` instead of `/ 5` in `src/lib/capabilities/matching/service.ts`
- [x] 5.9 Remove imports of `computeContextScore`, `computeFlowScore`, `computeThematicScore` from `src/lib/capabilities/matching/service.ts`

## 6. Playlist Profiling

- [x] 6.1 Remove `EmotionDistribution` type from `src/lib/capabilities/profiling/types.ts`
- [x] 6.2 Remove `emotionDistribution` field from `ComputedPlaylistProfile` in `src/lib/capabilities/profiling/types.ts`
- [x] 6.3 Remove `computeEmotionDistribution()` from `src/lib/capabilities/profiling/calculations.ts`
- [x] 6.4 Remove emotion distribution computation and persistence from `PlaylistProfilingService.computeProfile()` in `src/lib/capabilities/profiling/service.ts`
- [x] 6.5 Update `PlaylistProfilingService.getProfile()` to not read `emotionDistribution` from cached profile in `src/lib/capabilities/profiling/service.ts`

## 7. UI Types + Components

- [x] 7.1 Replace `AnalysisContent` interface with new flat shape: `headline?`, `compound_mood?`, `mood_description?`, `interpretation?`, `themes?`, `journey?`, `key_lines?`, `sonic_texture?`, `audio_features?` (all optional for dual-schema period) in `src/features/liked-songs/types.ts`
- [x] 7.2 Remove `ContextSection` component (`src/features/liked-songs/components/detail/ContextSection.tsx`) and remove its import + usage from `src/features/liked-songs/components/SongDetailPanel.tsx`
- [x] 7.3 Update `SongDetailPanel.tsx` to read analysis fields from the new flat structure instead of nested `meaning.interpretation.surface_meaning`, `emotional.dominant_mood`, etc.
- [x] 7.4 Update mock data in `src/lib/data/mock-data.ts` to match new flat analysis shape (remove `bestMoments`, restructure to flat fields)

## 8. Tests

- [x] 8.1 Rewrite `src/lib/capabilities/matching/__tests__/scoring.test.ts`: remove `scoreMoodTransition` and `computeFlowScore` tests, keep `computeAudioFeatureScore` tests unchanged
- [x] 8.2 Update `src/lib/capabilities/matching/__tests__/semantic.test.ts`: keep `cosineSimilarity` tests, remove any `SemanticMatcher` class tests if present
- [x] 8.3 Add unit tests for `computeAdaptiveWeights()` with 3-signal logic in `src/lib/capabilities/matching/__tests__/config.test.ts`
- [x] 8.4 Add unit test for instrumental detection logic (no lyrics, instrumentalness > 0.5, lyrics < 50 words) in `src/lib/capabilities/analysis/__tests__/song-analysis.test.ts`
- [x] 8.5 Add unit test for `buildEmbeddingText()` with lyrical and instrumental analysis shapes in `src/lib/ml/embedding/__tests__/service.test.ts`
- [x] 8.6 Update integration test `src/lib/capabilities/analysis/__tests__/analysis-pipeline-full-flow.integration.test.ts` for new schema shape and instrumental path
- [x] 8.7 Update `src/lib/capabilities/analysis/__tests__/pipeline-lyrics.test.ts` to reflect that missing lyrics no longer hard-fails but routes to instrumental path
- [x] 8.8 Run full test suite (`bun run test`) and fix any remaining type errors or broken assertions
