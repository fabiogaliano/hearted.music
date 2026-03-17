## 1. Worker lifecycle ownership

- [x] 1.1 Rewrite `src/worker/execute.ts` — heartbeat + chunk execution only, return `ExecuteResult`, errors propagate
- [x] 1.2 Rewrite `src/worker/poll.ts` — own full lifecycle: markCompleted → chain → preference writes, markFailed on error

## 2. Chain simplification

- [x] 2.1 Rewrite `src/worker/chain.ts` — replace `getActiveEnrichmentJob` + `createEnrichmentJob` with `getOrCreateEnrichmentJob`, remove `completedJobId` param, remove preference writes (moved to poll.ts)
- [x] 2.2 Rewrite `src/worker/__tests__/chain.test.ts` — remove preference mocks, replace job creation mocks with `getOrCreateEnrichmentJob`, remove "skips active job that matches completed" test

## 3. Shared progress factory

- [x] 3.1 Create `src/lib/workflows/enrichment-pipeline/progress.ts` — extract `makeInitialProgress` + `ALL_STAGE_NAMES`
- [x] 3.2 Update `chain.ts` to use `makeInitialProgress` instead of inline literal
- [x] 3.3 Update `trigger.ts` to use `makeInitialProgress` instead of inline literal
- [x] 3.4 Update `orchestrator.ts` to import from `progress.ts` instead of inline definition

## 4. Remove destination gate

- [x] 4.1 Rewrite `src/lib/workflows/enrichment-pipeline/trigger.ts` — remove `getDestinationPlaylists` import and check, gate on liked songs only

## 5. Delete dead orchestration surface

- [x] 5.1 Delete `runSongEnrichment`, `runDestinationProfiling`, `runMatching`, `runEnrichmentPipeline` from `orchestrator.ts`
- [x] 5.2 Delete `resolveBatchSize`, `collectStageJobIds`, `runStage` helpers from `orchestrator.ts`
- [x] 5.3 Delete `PipelineOptions`, `EnrichmentStageResult`, `EnrichmentRunResult` from `types.ts`
- [x] 5.4 Delete `src/lib/workflows/enrichment-pipeline/__tests__/orchestrator.test.ts`
- [x] 5.5 Delete `src/lib/workflows/enrichment-pipeline/__tests__/matching-stage.test.ts`
- [x] 5.6 Delete `src/lib/workflows/enrichment-pipeline/__tests__/pipeline.integration.test.ts`

## 6. Collapse stage files (atomic cutover)

- [x] 6.1 Delete `runAudioFeaturesStage`, rename `runAudioFeaturesWork` → `runAudioFeatures`, remove dead imports
- [x] 6.2 Delete `runGenreTaggingStage`, rename `runGenreTaggingWork` → `runGenreTagging`, remove dead imports
- [x] 6.3 Delete `runSongAnalysisStage`, rename `runSongAnalysisWork` → `runSongAnalysis`, remove dead imports
- [x] 6.4 Delete `runSongEmbeddingStage`, rename `runSongEmbeddingWork` → `runSongEmbedding`, remove dead imports
- [x] 6.5 Delete `runPlaylistProfilingStage` + `PlaylistProfilingOutput`, rename `runPlaylistProfilingWork` → `runPlaylistProfiling`, remove dead imports
- [x] 6.6 Delete `runMatchingStage`, rename `runMatchingWork` → `runMatching`, remove dead imports
- [x] 6.7 Update `orchestrator.ts` imports from `runXxxWork` → `runXxx`
- [x] 6.8 Delete `src/lib/workflows/enrichment-pipeline/job-runner.ts`

## 7. Split orchestrator into named phases

- [x] 7.1 Extract `enrichSongs()` helper — phases A-C: audio features + genre tagging (parallel), song analysis, song embedding
- [x] 7.2 Extract `placeSongs()` helper — phases D-E: playlist profiling, matching
- [x] 7.3 Extract `stageStatus()` helper to reduce inline ternaries
- [x] 7.4 `executeWorkerChunk` delegates to `enrichSongs` → `placeSongs`
