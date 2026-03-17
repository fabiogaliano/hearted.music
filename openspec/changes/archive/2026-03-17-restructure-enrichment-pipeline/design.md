## Context

After `add-background-enrichment-worker`, the codebase had two enrichment execution paths:

1. **Legacy Stage path**: `runSongEnrichment`, `runDestinationProfiling`, `runMatching`, `runEnrichmentPipeline` — called `runXxxStage` per stage, which used `runTrackedStageJob` to create per-stage job records and emit SSE progress. Zero production callers.

2. **Worker path**: `triggerEnrichmentIfReady` → `getOrCreateEnrichmentJob` → worker polls → `executeJob` → `executeWorkerChunk` → `runXxxWork` per stage. The only path used in production.

Each of the 6 stage files exported three functions: `getReadyForXxx`, `runXxxStage`, `runXxxWork`. The Stage variants were dead code kept alive by tests that validated the dead API surface.

### Lifecycle bug

`execute.ts` called `markJobCompleted`, then attempted `chainNextChunk`. If chaining failed, it caught the error and called `markJobFailed` — overwriting the completed status. The job had already succeeded; chain failure is a scheduling concern, not a job failure.

### Trigger gate

`triggerEnrichmentIfReady` required both liked songs AND destination playlists. Stages 1-4 (audio features, genre tagging, analysis, embedding) are pure song enrichment — they don't need destinations. The pipeline already handles missing destinations gracefully: profiling returns empty, matching skips.

## Goals

- Make the worker the only enrichment runtime
- Fix the lifecycle/chain ownership bug
- Remove ~900 lines of dead code
- One function per stage file (no Stage/Work duality)
- Unblock enrichment from the destination gate

## Non-Goals

- Changing stage business logic (readiness checks, service calls, result counting)
- Modifying database migrations or SQL functions
- Refactoring matching domain service internals
- Changing the sync endpoint's responsibility

## Decisions

**Delete Stage path instead of extracting shared cores.** The worker path covers the real runtime and real progress reporting. Reintroduce abstraction only when a second consumer exists.

**Poll loop owns lifecycle + chaining.** `execute.ts` was a god function (heartbeat, execution, lifecycle, chaining). Moving lifecycle to `poll.ts` gives each file one concern. Chain errors don't corrupt job state.

**`chain.ts` uses `getOrCreateEnrichmentJob`.** Replaces manual `getActiveEnrichmentJob` check + `createEnrichmentJob` two-step. One call, one responsibility owner, handles constraint races internally.

**Trigger gates on songs only.** Stages 1-4 don't need destinations. The pipeline handles missing destinations gracefully.

**`progress.ts` is the only new module.** Removes real duplication in 3 files (orchestrator, trigger, chain). Everything else cleaned up in place.

## Migration notes

### Renamed exports

| Old name | New name | File |
|----------|----------|------|
| `runAudioFeaturesWork` | `runAudioFeatures` | `stages/audio-features.ts` |
| `runGenreTaggingWork` | `runGenreTagging` | `stages/genre-tagging.ts` |
| `runSongAnalysisWork` | `runSongAnalysis` | `stages/song-analysis.ts` |
| `runSongEmbeddingWork` | `runSongEmbedding` | `stages/song-embedding.ts` |
| `runPlaylistProfilingWork` | `runPlaylistProfiling` | `stages/playlist-profiling.ts` |
| `runMatchingWork` | `runMatching` | `stages/matching.ts` |

### Deleted exports

`runSongEnrichment`, `runDestinationProfiling`, `runMatching` (orchestrator), `runEnrichmentPipeline`, `runTrackedStageJob`, `runXxxStage` (all 6), `PlaylistProfilingOutput`, `PipelineOptions`, `EnrichmentStageResult`, `EnrichmentRunResult`

### Changed signatures

- `executeJob(job)` → returns `ExecuteResult { hasMoreSongs, accountId, batchSequence }` instead of `void`
- `chainNextChunk(accountId, sequence, hasMore)` → removed `completedJobId` param, returns `string | null` (poll.ts handles preference writes)
- `triggerEnrichmentIfReady(accountId)` → no longer fetches destination playlists
