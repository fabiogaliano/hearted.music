## 1. Database: Add missing job type enum values

- [x] 1.1 Add `audio_features`, `song_embedding`, `playlist_profiling` to `job_type` enum via Supabase migration (`supabase/migrations/`)
- [x] 1.2 Regenerate TypeScript types with `bunx supabase gen types` to update `src/lib/data/database.types.ts`

## 2. Pipeline types and orchestrator

- [x] 2.1 Create `src/lib/workflows/enrichment-pipeline/types.ts` — define `PipelineOptions` (maxSongs, env var override), `PipelineStageResult` (stage name, job ID, succeeded/failed counts, error), `PipelineRunResult` (stages array, total duration), `PipelineRunError`
- [x] 2.2 Create `src/lib/workflows/enrichment-pipeline/orchestrator.ts` — implement `runEnrichmentPipeline(accountId, options?)` as a plain async function returning `Result<PipelineRunResult, PipelineRunError>`
- [x] 2.3 Implement Stage 1 (audio features): select batch-capped song IDs (`ORDER BY liked_at DESC LIMIT maxSongs`), call `AudioFeaturesService.getOrFetchFeatures()`, create job with type `audio_features`, emit SSE progress
- [x] 2.4 Implement Stage 2 (song analysis): call `AnalysisPipeline.getSongsNeedingAnalysis()` filtered to the batch song set, call `AnalysisPipeline.analyzeSongs()` — this already creates its own job internally
- [x] 2.5 Implement Stage 3 (song embeddings): query songs with `song_analysis` but no `song_embedding`, call `EmbeddingService.embedBatch()`, create job with type `song_embedding`, emit SSE progress
- [x] 2.6 Implement Stage 4 (playlist profiling): query destination playlists (`is_destination = true`), call `PlaylistProfilingService.computeProfile()` for each, create job with type `playlist_profiling`, emit SSE progress
- [x] 2.7 Implement Stage 5 (matching): query unactioned songs (no `item_status`), query profiled destination playlists, call `MatchingService.matchBatch()`, create `match_context` and store `match_result` rows — matching job type already exists
- [x] 2.8 Add error handling: wrap each stage in try/catch, log failures, collect `PipelineStageResult` per stage, continue to next stage on failure

## 3. Sync endpoint integration

- [x] 3.1 Modify `src/routes/api/extension/sync.tsx` — after Phase 3 (playlist tracks, ~line 382), call `runEnrichmentPipeline(accountId, { maxSongs: 5 })`
- [x] 3.2 Add `pipelineJobIds` to the sync response (separate from `phaseJobIds`), keyed by stage name
- [x] 3.3 Add `pipeline` field to response with per-stage results and any errors
- [x] 3.4 Ensure pipeline failures don't affect sync response — sync returns `ok: true` regardless of pipeline outcome

## 4. Batch cap configuration

- [x] 4.1 Read `PIPELINE_MAX_SONGS` from `process.env` in orchestrator, fallback to default of 5
- [x] 4.2 Apply batch cap to song selection query: most recently liked songs first (`ORDER BY liked_at DESC LIMIT maxSongs`)

## 5. Testing

- [x] 5.1 Write unit tests for orchestrator in `tests/workflows/enrichment-pipeline/orchestrator.test.ts` — test stage sequencing, batch cap enforcement, error isolation between stages
- [x] 5.2 Write integration test: trigger sync endpoint with test data, verify `song_analysis`, `song_embedding`, `playlist_profile`, `match_result` tables are populated
- [x] 5.3 Verify incremental behavior: run pipeline twice with same data, confirm second run is a no-op (zero items processed per stage)

## 6. Verification

- [ ] 6.1 Run full sync via extension against dev Supabase, confirm pipeline executes and populates all enrichment tables
- [ ] 6.2 Verify SSE progress events are emitted for each pipeline stage (subscribe to job IDs from response)
- [ ] 6.3 Confirm `match_result` contains scores for batch-capped songs matched against destination playlists
