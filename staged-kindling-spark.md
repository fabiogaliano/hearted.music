# Plan: Enrichment Pipeline Restructuring

## TL;DR
- **Summary:** Make the worker the only enrichment runtime that matters. Delete the legacy Stage/orchestration path, consolidate to one exported function per stage, fix worker lifecycle ownership, simplify job bootstrap, and unblock enrichment from the destination gate.
- **Deliverables:** dead orchestration APIs removed, dead tests removed, `job-runner.ts` removed, 6 stage files flattened, `execute.ts` made pure, `poll.ts` made the lifecycle owner, `chain.ts` reduced to scheduling, and one shared progress factory.
- **Effort:** Medium (7 tasks, with 1 intentional atomic cutover)
- **Test Strategy:** delete tests for deleted APIs, update worker tests for lifecycle/chaining behavior, keep the remaining worker/progress tests green.
- **Architectural stance:** solo dev, pre-production, one real consumer (the worker), building toward matching. Prefer less code and fewer seams now; reintroduce abstraction only when a second real consumer exists.

## Why this version of the plan
- **The worker is the real runtime.** `trigger.ts`, `poll.ts`, `execute.ts`, `chain.ts`, and `executeWorkerChunk` form the only production path that matters today.
- **The orchestration API is dead code.** `runSongEnrichment`, `runDestinationProfiling`, `runMatching`, and `runEnrichmentPipeline` have no production callers. Keeping them because tests exist is backwards.
- **The Stage path is duplication, not leverage.** `runXxxStage` exists to wrap `runTrackedStageJob` and stage-style progress. The product already gets progress from worker job polling, so maintaining both paths buys little and costs ongoing complexity.
- **The trigger change is safe in the current pipeline.** `runPlaylistProfilingWork` already returns an empty result when no destinations exist, and matching already skips when playlists are empty. Removing the destination gate does not require a new runtime mode.
- **The highest-confidence bug is lifecycle ownership.** Today `execute.ts` can mark a job completed and then later mark it failed if chaining fails. That ownership has to move up into `poll.ts`.

## Must NOT (Guardrails)
- Do not touch the enrichment stage business logic (readiness checks, service calls, result counting)
- Do not modify the database migrations or SQL functions
- Do not change the sync endpoint's responsibility (it keeps calling `triggerEnrichmentIfReady`)
- Do not refactor the matching domain service internals (that's a separate project)
- Do not introduce extra modules unless they remove real duplication immediately
- Do not move files just for aesthetics; keep churn low

## Tasks

### Task 1: Fix worker lifecycle ownership first
- **Files:**
  - `src/worker/execute.ts`
  - `src/worker/poll.ts`
- **Changes:**
  - Rewrite `executeJob` to do only heartbeat + chunk execution, then return `{ hasMoreSongs, accountId, batchSequence }`
  - Move terminal lifecycle ownership to `poll.ts`
  - In `poll.ts`, mark the job completed only after `executeJob` succeeds
  - If chaining fails after completion, log it but do not downgrade the completed job into failed
- **Why first:** fixes the clearest correctness bug before the deletion-heavy cutover starts
- **Validation:**
  - `bunx tsc --noEmit`
  - update worker tests to verify:
    - chaining failure does not mark a completed job failed
    - execution failure still marks the job failed

### Task 2: Simplify `chain.ts` to scheduling only
- **Files:**
  - `src/worker/chain.ts`
  - `src/worker/__tests__/chain.test.ts`
- **Changes:**
  - Remove preference mutations from `chain.ts`; pointer updates belong with lifecycle ownership in `poll.ts`
  - Replace `getActiveEnrichmentJob` + `createEnrichmentJob` with `getOrCreateEnrichmentJob`
  - Remove `completedJobId` from `chainNextChunk` if it is no longer needed after the `getOrCreateEnrichmentJob` switch
  - Update tests to mock `getOrCreateEnrichmentJob` directly and stop asserting preference writes from `chain.ts`
- **Validation:**
  - `bunx tsc --noEmit`
  - `bun run test` for chain tests

### Task 3: Extract one shared progress factory
- **Files:**
  - Create `src/lib/workflows/enrichment-pipeline/progress.ts`
  - Update `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
  - Update `src/lib/workflows/enrichment-pipeline/trigger.ts`
  - Update `src/worker/chain.ts`
- **Changes:**
  - Extract `makeInitialProgress`
  - Extract `ALL_STAGE_NAMES` only if it is still needed after the orchestration cleanup
  - Replace the inline `EnrichmentChunkProgress` object literals in trigger, chain, and orchestrator
- **Reason to keep this abstraction:** it removes real duplicated state construction in 3 places and prevents shape drift
- **Validation:** `bunx tsc --noEmit`

### Task 4: Remove the destination gate from `trigger.ts`
- **Files:** `src/lib/workflows/enrichment-pipeline/trigger.ts`
- **Changes:**
  - Remove `getDestinationPlaylists` from the trigger path
  - Gate only on liked songs existing
  - Update the function docstring/comments to say "liked songs" instead of "liked songs and destination playlists"
- **Why this stays in scope:** the existing pipeline already handles the no-destination case gracefully, so this is a simplification of trigger semantics, not a new runtime mode
- **Validation:** `bunx tsc --noEmit`

### Task 5: Delete the dead orchestration surface and its tests
- **Files:**
  - `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
  - `src/lib/workflows/enrichment-pipeline/types.ts`
  - Delete `src/lib/workflows/enrichment-pipeline/__tests__/orchestrator.test.ts`
  - Delete `src/lib/workflows/enrichment-pipeline/__tests__/matching-stage.test.ts`
  - Delete `src/lib/workflows/enrichment-pipeline/__tests__/pipeline.integration.test.ts`
- **Changes:**
  - Delete `runSongEnrichment`, `runDestinationProfiling`, `runMatching`, and `runEnrichmentPipeline`
  - Delete the helpers that only existed for that orchestration path
  - Delete `PipelineOptions` and `EnrichmentRunResult`
  - Keep `orchestrator.ts` as the worker chunk executor file for now to avoid unnecessary file churn
- **Why delete the tests:** they validate the deleted API surface, not the worker runtime we are keeping
- **Validation:**
  - `bunx tsc --noEmit`
  - `bun run test`

### Task 6: Collapse the stage files to one exported worker function each
- **Files:**
  - `src/lib/workflows/enrichment-pipeline/stages/audio-features.ts`
  - `src/lib/workflows/enrichment-pipeline/stages/genre-tagging.ts`
  - `src/lib/workflows/enrichment-pipeline/stages/song-analysis.ts`
  - `src/lib/workflows/enrichment-pipeline/stages/song-embedding.ts`
  - `src/lib/workflows/enrichment-pipeline/stages/playlist-profiling.ts`
  - `src/lib/workflows/enrichment-pipeline/stages/matching.ts`
  - `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
  - `src/lib/workflows/enrichment-pipeline/types.ts`
  - Delete `src/lib/workflows/enrichment-pipeline/job-runner.ts`
- **Changes:**
  - Delete every `runXxxStage`
  - Rename every `runXxxWork` to `runXxx`
  - Remove `runTrackedStageJob`, `EnrichmentStageResult`, and any stage-only output types that no longer have callers
  - Update orchestrator imports/call sites to the new worker-only function names
  - Delete `job-runner.ts` after no stage file imports it
- **Important note:** this is the one intentional atomic cutover in the plan; do it in one pass
- **Validation:** `bunx tsc --noEmit`

### Task 7: Slim `orchestrator.ts` into a worker-only executor
- **Files:** `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
- **Changes:**
  - Remove leftover imports and helpers from the deleted orchestration path
  - Keep only the worker chunk execution logic and the minimal bootstrap/context helpers it still needs
  - Split `executeWorkerChunk` into named private helpers for readability:
    - song-side stages: audio features, genre tagging, song analysis, song embedding
    - placement-side stages: playlist profiling, matching
  - Do not create extra runtime/context modules unless the file still feels unreasonably large after the deletions
- **Validation:**
  - `bunx tsc --noEmit`
  - `bun run test`

## Decisions

**Delete the Stage path instead of extracting shared cores.** In this codebase, extraction would create more layers to support a path that has no meaningful product consumer. The worker path already covers the real runtime and real progress reporting.

**Keep the worker as the authoritative runtime.** The refactor should make the codebase reflect current reality instead of preserving optional surfaces for hypothetical future consumers.

**Make `poll.ts` own lifecycle + chaining.** `execute.ts` should execute work; `poll.ts` should decide job status and follow-up scheduling.

**Remove the destination gate now.** This is safe because the current pipeline already no-ops the destination-dependent stages when there are no playlists.

**Keep new abstractions to a minimum.** The only new file this plan intentionally adds is `progress.ts`, because it removes real duplication immediately. Everything else should be cleaned up in place.

## Risks

**Temporary coverage reduction is intentional.** The deleted tests cover dead APIs, not the runtime we are keeping. That is acceptable for a solo-dev pre-production refactor as long as worker tests stay green.

**`song-analysis.ts` remains the odd stage.** Its `createAnalysisPipeline().analyzeSongs()` path may still create nested job behavior even after the surface cleanup. This plan does not change that business logic.

**Task 6 is an atomic cutover.** The codebase may not compile mid-edit while stage exports and orchestrator imports are being renamed together. Finish that task in one pass.

## Definition of done
- the worker is the only enrichment runtime left in the codebase
- dead orchestration APIs and their tests are gone
- each stage exposes one worker-oriented function
- `execute.ts`, `poll.ts`, and `chain.ts` have clean ownership boundaries
- trigger creation depends only on liked songs existing
- the remaining code is smaller, flatter, and easier to evolve toward matching
