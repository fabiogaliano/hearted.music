# Plan: Refactor enrichment pipeline architecture

## TL;DR
- **Summary:** Restructure the enrichment pipeline with batch-first orchestration, per-stage readiness checks, and 3-phase parallel execution
- **Deliverables:** Normalized orchestrator, readiness pattern for all stages, parallelized independent stages, bug fix for `getPending()`, renamed `maxSongs` → `batchSize`
- **Effort:** Medium (11 files modified, no new files)
- **Test Strategy:** Update existing unit + integration tests, then verify with `bun run test` and manual sync trigger
- **Original Problem:** Embedding stage reports "Missing analysis" failures for songs that simply aren't ready yet. Root cause: stages independently decide what to work on instead of checking readiness within a shared batch.
- **Key Constraints:** Keep stages as functions (not classes). No backfill pipeline (app not in prod). Use existing `selectPipelineBatch` and `runTrackedStageJob` utilities.

## Must NOT (Guardrails)
- Do NOT change `likedSongs.getAll()` — sync orchestrator needs it for diffing (includes unliked)
- Do NOT convert `AnalysisPipeline` class to functions — it has internal state (LLM, lyrics service)
- Do NOT add retry logic, health checks, or dependency graphs to readiness functions
- Do NOT create new files — all changes fit in existing files

## Tasks

### Task 1: Update types — rename `maxSongs`, simplify context, add readiness types
- **Files:** `src/lib/workflows/enrichment-pipeline/types.ts`
- **Changes:**
  - `PipelineOptions.maxSongs` → `PipelineOptions.batchSize` (line 15)
  - Remove from `EnrichmentContext`: `maxSongs`, `selectedBatchSongIds`, `selectedBatchSongs` (lines 57-61)
  - Keep `destinationPlaylists` on ctx (playlist_profiling writes it, matching reads it)
  - Add `ReadyResult` type: `{ ready: string[], notReady: string[], done: string[] }`
  - Update `EnrichmentStageResult` "completed" variant: add `notReady: number`, `cached: number` fields alongside existing `succeeded`/`failed`
- **Validation:** TypeScript compilation (errors expected until other files updated)
- **References:** Current types at `types.ts:14-63`

### Task 2: Move batch selection to orchestrator, parallelize stages
- **Files:** `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
- **Changes:**
  - Import `selectPipelineBatch`, `PipelineBatch` from `./batch`
  - Rename `ENV_MAX_SONGS_KEY` → `"PIPELINE_BATCH_SIZE"` (line 18). Also support old `PIPELINE_MAX_SONGS` as fallback.
  - Resolve `batchSize` from env → `options.batchSize` → default 5 (line 42-45)
  - Call `selectPipelineBatch(accountId, batchSize)` before stages (after EmbeddingService init)
  - If `batch.songIds.length === 0`, return early with all stages skipped
  - Build simplified `EnrichmentContext` (no batch fields, no maxSongs)
  - Replace sequential stage execution (lines 69-75) with 3-phase hybrid:
    ```
    Phase A (parallel): audio_features(ctx, batch) + song_analysis(ctx, batch) + playlist_profiling(ctx)
    Phase B (sequential): song_embedding(ctx, batch)
    Phase C (sequential): matching(ctx, batch)
    ```
  - Each stage wrapped in `runStage()` for error isolation — `Promise.all` safe because `runStage` catches errors and returns `{status: "failed"}`
  - **Failure behavior:** If `playlist_profiling` fails in Phase A, `ctx.destinationPlaylists` remains `[]` (init'd in orchestrator). Matching in Phase C skips gracefully (matching.ts:42-44 checks `playlists.length === 0`).
  - Collect results into `stages` array in consistent order
- **Validation:** `bun run test -- orchestrator` passes
- **References:** Current orchestrator at `orchestrator.ts:36-88`, `runStage` wrapper at lines 20-34

### Task 3: Decouple batch selection from audio-features stage, add readiness
- **Files:** `src/lib/workflows/enrichment-pipeline/stages/audio-features.ts`
- **Changes:**
  - Change signature: `runAudioFeaturesStage(ctx: EnrichmentContext, batch: PipelineBatch)`
  - Remove `import { selectPipelineBatch } from "../batch"` (line 6) and its call (line 15)
  - Remove `ctx.selectedBatchSongIds = ...` and `ctx.selectedBatchSongs = ...` mutations (lines 20-21)
  - Use `batch.songIds` and `batch.spotifyIdBySongId` directly
  - Export `getReadyForAudioFeatures(batchSongIds: string[]): Promise<ReadyResult>` — checks `audioFeatureData.getBatch()` to split into ready/done
  - Call `getReadyForAudioFeatures` at top of `runAudioFeaturesStage`, skip if empty, report `cached`/`notReady` counts in result
- **Validation:** Stage processes only songs without existing audio features
- **References:** Current stage at `audio-features.ts:10-65`, `audioFeatureData.getBatch` at `audio-features/queries.ts:67`

### Task 4: Replace analysis intersection with direct readiness check
- **Files:** `src/lib/workflows/enrichment-pipeline/stages/song-analysis.ts`
- **Changes:**
  - Change signature: `runSongAnalysisStage(ctx: EnrichmentContext, batch: PipelineBatch)`
  - Export `getReadyForSongAnalysis(batchSongIds: string[]): Promise<ReadyResult>` — checks `songAnalysisData.get(batchSongIds)` (returns Map), songs not in map = ready
  - Replace current logic (lines 10-31): instead of calling `pipeline.getSongsNeedingAnalysis()` + intersecting with batch, call `getReadyForSongAnalysis(batch.songIds)`
  - Build `SongToAnalyze[]` from `batch.songs` for ready IDs using this mapping:
    ```typescript
    // Song (from batch.songs) → SongToAnalyze (for AnalysisPipeline.analyzeSongs)
    { songId: song.id, artist: song.artists[0] ?? "Unknown Artist", title: song.name, lyrics: "" }
    ```
    Lyrics left empty — `AnalysisPipeline.analyzeSongs()` prefetches them via Genius internally (pipeline.ts:201-205)
  - Still call `createAnalysisPipeline()` and `pipeline.analyzeSongs()` for the actual work — no hidden state coupling, `analyzeSongs` does not depend on `getSongsNeedingAnalysis` having been called
  - Report `cached`/`notReady` counts
- **Validation:** Stage only analyzes batch songs that lack analysis records
- **References:** Current stage at `song-analysis.ts:5-53`, `SongToAnalyze` type at `pipeline.ts:85-90` (`{songId, artist, title, lyrics}`), `songAnalysis.get(songIds[])` returns `Map` at `content-analysis/queries.ts:60-90`

### Task 5: Add readiness check to embedding stage (the core fix)
- **Files:** `src/lib/workflows/enrichment-pipeline/stages/song-embedding.ts`
- **Changes:**
  - Change signature: `runSongEmbeddingStage(ctx: EnrichmentContext, batch: PipelineBatch)`
  - Export `getReadyForSongEmbedding(batchSongIds: string[], embeddingService: EmbeddingService): Promise<ReadyResult>`:
    - Query `songAnalysisData.get(batchSongIds)` → which have analysis
    - Query `embeddingService.getEmbeddings(batchSongIds)` → which already have embeddings
    - ready = has analysis AND no embedding
    - notReady = no analysis (previously reported as "Missing analysis" failure)
    - done = already has embedding
  - Call `getReadyForSongEmbedding` at top, only pass `ready` IDs to `embedBatch()`
  - Report `notReady` count separately from `failed` count
- **Validation:** Songs without analysis are reported as `notReady`, not `failed`. Only songs with analysis are embedded.
- **References:** Current stage at `song-embedding.ts:5-51`, `EmbeddingService.getEmbeddings()` at `embeddings/service.ts:389`

### Task 6: Add readiness check to matching stage
- **Files:** `src/lib/workflows/enrichment-pipeline/stages/matching.ts`
- **Changes:**
  - Change signature: `runMatchingStage(ctx: EnrichmentContext, batch: PipelineBatch)`
  - Replace `ctx.selectedBatchSongIds` → `batch.songIds`, `ctx.selectedBatchSongs` → `batch.songs` throughout
  - Export `getReadyForMatching(accountId: string, batchSongIds: string[]): Promise<ReadyResult>`:
    - Query `likedSongData.getPending(accountId)` → pending songs
    - Intersect with batch → ready = pending AND in batch, done = not pending (already matched/ignored)
    - Note: embedding check happens inside the stage when it fetches embeddings, not in readiness
  - Report `notReady`/`cached` counts
- **Validation:** Only pending batch songs are matched
- **References:** Current stage at `matching.ts:20-195`, `getPending` at `liked-songs/queries.ts:205`

### Task 7: Update playlist-profiling stage (minor ctx changes)
- **Files:** `src/lib/workflows/enrichment-pipeline/stages/playlist-profiling.ts`
- **Changes:**
  - No signature change (doesn't use batch)
  - Ensure `ctx.destinationPlaylists = playlists` still works with simplified context
  - This is a no-op if EnrichmentContext still has `destinationPlaylists` (it does)
- **Validation:** Stage still profiles playlists and stores them on ctx
- **References:** Current stage at `playlist-profiling.ts:8-96`

### Task 8: Fix `getPending()` bug — missing `unliked_at IS NULL` filter
- **Files:** `src/lib/domains/library/liked-songs/queries.ts`
- **Changes:**
  - In `getPending()` (line ~212): the internal query fetches all liked songs without filtering `unliked_at`. Add `.is("unliked_at", null)` to exclude soft-deleted songs.
  - Do NOT change `getAll()` — sync orchestrator uses it for diffing and needs unliked records.
- **Validation:** `getPending()` no longer returns unliked songs
- **References:** `getPending` at `queries.ts:205-253`, `getAll` at `queries.ts:62-73`

### Task 9: Rename `maxSongs` → `batchSize` in caller
- **Files:** `src/routes/api/extension/sync.tsx`
- **Changes:**
  - Find `{ maxSongs: 5 }` → `{ batchSize: 5 }`
- **Validation:** TypeScript compiles
- **References:** Caller at `sync.tsx` (search for `maxSongs`)

### Task 10: Update unit tests
- **Files:** `src/lib/workflows/enrichment-pipeline/__tests__/orchestrator.test.ts`
- **Changes:**
  - Add `vi.mock("../batch")` to mock `selectPipelineBatch` — return a fake `PipelineBatch` with songIds, songs, spotifyIdBySongId
  - Update all stage mocks to accept `(ctx, batch)` instead of `(ctx)` (playlist_profiling stays `(ctx)`)
  - Replace `maxSongs` → `batchSize`:
    - Line ~143: test name "respects maxSongs option" → "respects batchSize option"
    - Line ~146: `{ maxSongs: 42 }` → `{ batchSize: 42 }`
    - Line ~149: `ctx.maxSongs` assertion → verify `selectPipelineBatch` called with correct size
    - Line ~152-159: env var test `PIPELINE_MAX_SONGS` → `PIPELINE_BATCH_SIZE`
    - Line ~162-168: default test "defaults maxSongs to 5" → "defaults batchSize to 5"
  - Replace sequential call-order test (lines ~96-141) with phase-based assertions:
    - All three Phase A stages called (order among them non-deterministic — assert all called, don't assert order)
    - Phase B (embedding) called after Phase A
    - Phase C (matching) called after Phase B
  - Remove assertions about `ctx.selectedBatchSongIds` / `ctx.selectedBatchSongs` / `ctx.maxSongs` (no longer on context)
  - Update `completedResult` helper to include `notReady: 0`, `cached: 0` fields
  - Add new test: "returns early with all skipped if batch is empty" — mock `selectPipelineBatch` returning empty songIds
  - Line ~82: `delete process.env.PIPELINE_MAX_SONGS` → `delete process.env.PIPELINE_BATCH_SIZE`
- **Validation:** `bun run test -- orchestrator` passes
- **References:** Current tests at `__tests__/orchestrator.test.ts`

### Task 11: Update integration tests
- **Files:** `src/lib/workflows/enrichment-pipeline/__tests__/pipeline.integration.test.ts`
- **Changes:**
  - `{ maxSongs: 2 }` → `{ batchSize: 2 }` (lines 30, 78)
  - Update result assertions if stage result shape changed
- **Validation:** Integration tests pass (when env vars available)
- **References:** Current tests at `__tests__/pipeline.integration.test.ts`

## Decisions

1. **Don't change `getAll()`** — sync orchestrator (`sync.tsx:264`, `spotify-sync/orchestrator.ts:77`) uses it for initial vs incremental sync diffing, which needs all records including unliked. Fix only `getPending()`.

2. **`getSongsNeedingAnalysis` is bypassed, not deleted** — the `AnalysisPipeline` class still owns it, and it might be used elsewhere. The enrichment pipeline stages no longer call it; they use direct readiness queries instead.

3. **Readiness functions take minimal params** — `getReadyForSongEmbedding` takes `embeddingService` for the model info needed by `getEmbeddings()`. Others just take `batchSongIds`. No passing the full context to readiness functions.

4. **`destinationPlaylists` stays on mutable ctx** — profiling writes it in Phase A, matching reads it in Phase C. Safe because `Promise.all` for Phase A resolves before Phase C starts. Noted as future cleanup candidate.

5. **Support old env var as fallback** — `PIPELINE_BATCH_SIZE` is primary, `PIPELINE_MAX_SONGS` is fallback. Simple `??` chain, no deprecation warnings needed (app not in prod).

6. **Stage result shape is additive** — `notReady` and `cached` are new fields on the "completed" variant. `succeeded`/`failed` remain. Sync route response includes stage results but doesn't destructure specific fields, so it's backward compatible.

## Risks

1. **Phase A error isolation** — `Promise.all` rejects on first error. Mitigated: each stage is wrapped in `runStage()` which catches errors and returns `{status: "failed"}`. All three always resolve.

2. **Song details for analysis** — bypassing `getSongsNeedingAnalysis` means we build `SongToAnalyze[]` from `batch.songs` directly. Risk: `batch.songs` might not have all needed fields. Mitigated: `Song` type has `name`, `artists[]`, verified from `songs/queries.ts` and `batch.ts` usage.

3. **Embedding readiness query overhead** — `getReadyForSongEmbedding` queries both analysis and embedding tables. These are indexed lookups on small batch sizes (5-10 songs), so performance impact is negligible.
