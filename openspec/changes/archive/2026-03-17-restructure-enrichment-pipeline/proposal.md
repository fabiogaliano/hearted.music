## Why

The enrichment pipeline had two parallel execution paths: a legacy "Stage" path (`runTrackedStageJob` + SSE per-stage jobs) and a worker path (`executeWorkerChunk` + DB polling). Only the worker runs in production. Maintaining both doubled maintenance surface, created naming confusion (`runXxxStage` vs `runXxxWork`), and hid a lifecycle bug where chain errors could corrupt job status.

Additionally, the trigger gated all enrichment on destination playlists existing — blocking song enrichment (stages 1-4) that doesn't need destinations.

## What Changes

- Worker is the sole enrichment runtime; legacy orchestration API surface deleted
- Each stage file exports one function instead of two (Stage + Work)
- `execute.ts` is pure (heartbeat + run); `poll.ts` owns lifecycle (complete/fail/chain/preferences)
- `chain.ts` uses `getOrCreateEnrichmentJob` instead of manual pre-check + create
- `triggerEnrichmentIfReady` gates on liked songs only, not destination playlists
- Shared `makeInitialProgress` factory replaces 3 inline progress literals
- `executeWorkerChunk` split into `enrichSongs()` (phases A-C) and `placeSongs()` (phases D-E)

## Affected specs

- `add-background-enrichment-worker` — references deleted orchestration functions in design.md/tasks.md (historical, not updated)
- `connect-matching-pipeline-to-ui` — references deleted orchestration functions and test files (historical, not updated)

## Capabilities

### Removed Capabilities
- `runSongEnrichment`: deleted, no production callers
- `runDestinationProfiling`: deleted, no production callers
- `runMatching`: deleted, no production callers
- `runEnrichmentPipeline`: deleted, no production callers
- `runTrackedStageJob` / `job-runner.ts`: deleted, no importers remain
- Per-stage tracked jobs with SSE progress: removed (worker uses DB polling)

### Modified Capabilities
- `triggerEnrichmentIfReady`: no longer requires destination playlists
- `chainNextChunk`: simplified signature, no `completedJobId` param, uses `getOrCreateEnrichmentJob`
- `executeJob`: returns `ExecuteResult` instead of `void`, no longer owns lifecycle
- Stage functions renamed: `runXxxWork` → `runXxx` (e.g. `runAudioFeatures`, `runMatching`)

## Impact

- **Worker runtime** (`src/worker/`): `execute.ts`, `poll.ts`, `chain.ts` — ownership boundaries clarified
- **Pipeline orchestration** (`src/lib/workflows/enrichment-pipeline/orchestrator.ts`): ~260 lines of dead code removed, split into `enrichSongs`/`placeSongs` helpers
- **Stage files** (`src/lib/workflows/enrichment-pipeline/stages/`): 6 files, ~550 lines of dead Stage functions removed
- **Types** (`types.ts`): `PipelineOptions`, `EnrichmentStageResult`, `EnrichmentRunResult` deleted
- **Trigger** (`trigger.ts`): destination gate removed
- **New file** (`progress.ts`): shared `makeInitialProgress` + `ALL_STAGE_NAMES`
- **Deleted files**: `job-runner.ts`, `orchestrator.test.ts`, `matching-stage.test.ts`, `pipeline.integration.test.ts`
