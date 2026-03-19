## 1. Database: Add missing job type enum values

- [x] 1.1 Add `audio_features`, `song_embedding`, `playlist_profiling`, and `genre_tagging` to `job_type` via Supabase migrations in `supabase/migrations/`
- [x] 1.2 Regenerate TypeScript types to update `src/lib/data/database.types.ts`

## 2. Pipeline batch, types, and orchestrator

- [x] 2.1 Create `src/lib/workflows/enrichment-pipeline/batch.ts` — define `PipelineBatch` and central batch selection from the most recently liked songs
- [x] 2.2 Create `src/lib/workflows/enrichment-pipeline/types.ts` — define `PipelineOptions` (`batchSize`), `EnrichmentStageName`, `EnrichmentStageResult`, `EnrichmentRunResult`, and `PipelineBootstrapError`
- [x] 2.3 Create `src/lib/workflows/enrichment-pipeline/orchestrator.ts` — implement `runEnrichmentPipeline(accountId, options?)` as a plain async function returning `Result<EnrichmentRunResult, PipelineBootstrapError>`
- [x] 2.4 Implement Phase A prep stages: `src/lib/workflows/enrichment-pipeline/stages/audio-features.ts`, `genre-tagging.ts`, and `playlist-profiling.ts`
- [x] 2.5 Implement Phase B/C dependent stages: `src/lib/workflows/enrichment-pipeline/stages/song-analysis.ts` and `song-embedding.ts`
- [x] 2.6 Implement Phase D matching stage in `src/lib/workflows/enrichment-pipeline/stages/matching.ts` using destination playlists returned from playlist profiling
- [x] 2.7 Add stage isolation so thrown errors become failed stage results while the pipeline continues

## 3. Sync endpoint integration

- [x] 3.1 Modify `src/routes/api/extension/sync.tsx` — after Phase 3 (playlist tracks), call `runEnrichmentPipeline(accountId)`
- [x] 3.2 Keep the extension response slim: return sync results and `phaseJobIds` only while running the enrichment pipeline internally
- [x] 3.3 Ensure pipeline failures do not change the sync response contract: sync still returns `ok: true`
- [x] 3.4 Allow destination-dependent stages to skip until onboarding has saved one or more destination playlists

## 4. Batch size configuration

- [x] 4.1 Read `PIPELINE_BATCH_SIZE` from `process.env` in the orchestrator, with legacy fallback to `PIPELINE_MAX_SONGS`
- [x] 4.2 Apply batch selection using most recently liked songs first (`ORDER BY liked_at DESC LIMIT batchSize`) in `src/lib/workflows/enrichment-pipeline/batch.ts`

## 5. Testing

- [x] 5.1 Write unit tests in `src/lib/workflows/enrichment-pipeline/__tests__/orchestrator.test.ts` covering stage ordering, batch-size enforcement, and failure isolation
- [x] 5.2 Write integration coverage in `src/lib/workflows/enrichment-pipeline/__tests__/pipeline.integration.test.ts` covering sync-triggered pipeline execution and table population
- [x] 5.3 Verify reruns are idempotent at the stage level (already-done items are skipped or reported as `done`)

## 6. Verification

- [ ] 6.1 Run full sync via the extension against dev Supabase and confirm the six-stage pipeline executes
- [ ] 6.2 Verify SSE progress events are emitted for each created pipeline job ID
- [ ] 6.3 Confirm `match_result` contains scores for the selected liked-song batch against profiled destination playlists
