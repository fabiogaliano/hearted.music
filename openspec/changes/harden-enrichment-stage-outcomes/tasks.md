## 1. Characterization Tests

- [x] 1.1 Add tests for `src/lib/workflows/enrichment-pipeline/failure-policy.ts` covering all existing failure codes and the new `content_activation_failed` code.
- [x] 1.2 Add a regression test showing a thrown stage handler records one failure per candidate song and returns failed count equal to candidate count.
- [x] 1.3 Add a regression test for readiness-check failure: candidate songs receive durable non-terminal failures rather than count-only failures.
- [x] 1.4 Add a test proving `analysis_inputs_missing` compensation is triggered only for terminal analysis-input failures and only after durable failure recording succeeds.
- [x] 1.5 Add a test proving content activation DB/RPC failure leaves songs unactivated and records retryable failures.

## 2. Add Stage Outcome Model

- [x] 2.1 Create `src/lib/workflows/enrichment-pipeline/stage-outcomes.ts` (or a small sibling folder if the file becomes large).
- [x] 2.2 Keep the canonical `EnrichmentStageName` in `types.ts` and import it directly from the outcome module without adding a barrel export.
- [x] 2.3 Define `StageFailure`, `StageOutcome`, `StageSummary`, and `StageAccountingError` with discriminated unions.
- [x] 2.4 Add validation helpers that reject overlaps between `succeededSongIds` and `failures[].songId` in tests and dev mode.
- [x] 2.5 Add unit tests for summary derivation and illegal outcome detection.

## 3. Centralize Outcome Finalization

- [x] 3.1 Implement `finalizeStageOutcome(...)` to resolve prior non-terminal failures for successes.
- [x] 3.2 Move failure-row recording through the existing `recordStageFailure(...)` wrapper.
- [x] 3.3 Return `Result<StageSummary, StageAccountingError>` when resolving or recording fails.
- [x] 3.4 Move analysis compensation trigger into the accounting module for `stage = "song_analysis"` and `failureCode = analysis_inputs_missing`.
- [x] 3.5 Remove direct calls to `resolveStageFailures` and `recordStageFailure` from migrated stage modules.
- [x] 3.6 Add tests proving failure-row persistence, prior-failure resolution, and compensation persistence errors return `StageAccountingError` instead of success-shaped summaries.

## 4. Update Progress Model

- [x] 4.1 Add `content_activation` to `EnrichmentStageName`.
- [x] 4.2 Update `src/lib/platform/jobs/progress/enrichment.ts` and `src/lib/workflows/enrichment-pipeline/progress.ts` so initial progress includes `content_activation`.
- [x] 4.3 Update progress parser tests in `src/lib/platform/jobs/progress/__tests__/parse.test.ts`.
- [x] 4.4 Update orchestrator progress application to consume `StageSummary` from finalized outcomes.

## 5. Replace Generic Stage Runner

- [x] 5.1 Replace `runStage(stageName, fn)` in `orchestrator.ts` with a wrapper that accepts `candidateSongIds` and finalizes `StageOutcome`.
- [x] 5.2 On thrown stage errors, create per-candidate failures with a non-terminal fallback code and preserve the original error message in `error_message`.
- [x] 5.3 If finalizing the generated failure outcome fails, return a parent attempt failure to the runner rather than applying partial progress.
- [x] 5.4 Add tests for thrown `audio_features`, `genre_tagging`, `song_analysis`, and `song_embedding` handlers using candidate counts greater than one.

## 6. Migrate Audio Features Stage

- [x] 6.1 Update `src/lib/workflows/enrichment-pipeline/stages/audio-features.ts` so `getReadyForAudioFeatures` returns readiness facts and `runAudioFeatures` returns `StageOutcome`.
- [x] 6.2 Convert ReccoBeats `not_found` and transient failures to `StageFailure` descriptors.
- [x] 6.3 Remove direct `resolveStageFailures` / `recordStageFailure` calls from the audio stage.
- [x] 6.4 Add tests for cached features, fetched features, not-found failures, and provider transient failures.

## 7. Migrate Genre Tagging Stage

- [x] 7.1 Update `src/lib/workflows/enrichment-pipeline/stages/genre-tagging.ts` to return `StageOutcome`.
- [x] 7.2 Convert provider errors, not-found, and unavailable buckets to `StageFailure` descriptors.
- [x] 7.3 Remove direct failure-row writes from the stage.
- [x] 7.4 Add tests for fetched/cached genres, provider unavailable, source not found, and batch-wide DB failure.

## 8. Extract Jobless Song Batch Analysis

- [x] 8.1 Create `src/lib/domains/enrichment/content-analysis/song-batch-analysis.ts` for lyrics/audio input evidence classification and batch analysis without job creation.
- [x] 8.2 Keep prompt/schema and single-song LLM logic in `song-analysis.ts`; reuse it from the batch analyzer.
- [x] 8.3 Leave `AnalysisPipeline.analyzeSongs(...)` intact only for standalone/manual flows, but stop using it from `stages/song-analysis.ts`.
- [x] 8.4 Ensure the worker path no longer creates child `song_analysis` job rows.
- [x] 8.5 Preserve parent enrichment measurement details needed by library-processing terminal-ref recovery.
- [x] 8.6 Add tests proving the jobless analyzer returns skipped confirmed-input, skipped unconfirmed, analyzed, and failed buckets without touching `src/lib/platform/jobs/lifecycle.ts`.

## 9. Migrate Song Analysis Stage

- [x] 9.1 Update `src/lib/workflows/enrichment-pipeline/stages/song-analysis.ts` to call the jobless batch analyzer and return `StageOutcome`.
- [x] 9.2 Map skipped confirmed inputs to `analysis_inputs_missing`.
- [x] 9.3 Map unconfirmed lyrics/audio/both buckets to their existing non-terminal failure codes.
- [x] 9.4 Map post-run lookup failure to `analysis_postrun_lookup_unavailable` for each uncertain song.
- [x] 9.5 Map genuine analysis failures to `permanent` only when post-run state confirms no analysis was written.
- [x] 9.6 Add tests for each failure bucket and compensation trigger.

## 10. Migrate Song Embedding Stage

- [x] 10.1 Update `src/lib/workflows/enrichment-pipeline/stages/song-embedding.ts` to return `StageOutcome`.
- [x] 10.2 Map missing analysis failures to `validation` and other embedding failures to `permanent` unless a provider-specific transient error is introduced.
- [x] 10.3 Remove direct failure-row writes from the stage.
- [x] 10.4 Add tests for existing embedding skip, ready embedding success, missing-analysis failure, and provider failure.

## 11. Account for Content Activation

- [x] 11.1 Update `src/lib/workflows/enrichment-pipeline/stages/content-activation.ts` to return `StageOutcome` instead of `Promise<void>`.
- [x] 11.2 Check `Result` values from `markItemsNew(...)` and convert DB failures to `content_activation_failed` descriptors.
- [x] 11.3 Treat missing unlimited subscription provenance as retryable `content_activation_failed` rather than silently falling back to item_status only.
- [x] 11.4 For self-hosted activation, require both item_status and unlock-row persistence to succeed before marking IDs succeeded.
- [x] 11.5 Add tests for free/pack, subscription, self-hosted, missing provenance, and RPC failure paths.

## 12. Clean Up and Verify

- [x] 12.1 Remove old count-only `StageResult` and direct `applyStageResult` usage from `orchestrator.ts`.
- [x] 12.2 Grep for direct `recordStageFailure` and `resolveStageFailures` imports under `src/lib/workflows/enrichment-pipeline/stages/`; ensure none remain.
- [x] 12.3 Grep for worker-path `song_analysis` job creation; ensure enrichment uses only the parent job row.
- [x] 12.4 Run focused tests: `bun run test src/lib/workflows/enrichment-pipeline src/lib/domains/enrichment/content-analysis`.
- [x] 12.5 Run `bun run typecheck`.
- [x] 12.6 Run full `bun run test`.
- [x] 12.7 Run `openspec validate harden-enrichment-stage-outcomes --strict --no-interactive` and `openspec validate harden-job-work-orchestration --strict --no-interactive`.
