## Context

The sync endpoint now invokes the enrichment pipeline after persistence completes, and the latest refactor restructured that pipeline around an orchestrator-owned `PipelineBatch` plus explicit stage modules under `src/lib/workflows/enrichment-pipeline/`.

The shipped pipeline differs from the earlier design in three important ways:

- it runs **six** stages, not five, because `genre_tagging` is now a first-class stage
- it is **dependency-ordered**, not purely sequential: `audio_features`, `genre_tagging`, and `playlist_profiling` run in a parallel-safe prep phase before the dependent song-analysis stages
- it uses `batchSize` and `PIPELINE_BATCH_SIZE`, with legacy fallback to `PIPELINE_MAX_SONGS`

Existing infrastructure used by this change:
- `selectPipelineBatch()` (`src/lib/workflows/enrichment-pipeline/batch.ts`) — selects the liked-song batch once and shares it across stages
- `AnalysisPipeline` (`src/lib/domains/enrichment/content-analysis/pipeline.ts`) — batch song analysis with job tracking and SSE progress
- `EmbeddingService` (`src/lib/domains/enrichment/embeddings/service.ts`) — embeds song analysis text and reads stored embeddings
- `PlaylistProfilingService` (`src/lib/domains/taste/playlist-profiling/service.ts`) — computes playlist profiles from currently available signals
- `MatchingService` (`src/lib/domains/taste/song-matching/service.ts`) — multi-factor scoring with tracked batch matching
- `AudioFeaturesService` (`src/lib/integrations/audio/service.ts`) — free audio feature backfill via ReccoBeats
- `GenreEnrichmentService` (`src/lib/domains/enrichment/genre-tagging/service.ts`) — free genre backfill via Last.fm when available
- Job lifecycle + SSE helpers under `src/lib/platform/jobs/`

## Goals / Non-Goals

**Goals:**
- document the orchestrator and sync-response contract that actually shipped
- document the current dependency ordering between pipeline stages
- document current batch selection and environment override semantics
- preserve the guarantee that pipeline failures do not fail sync itself

**Non-Goals:**
- UI rewiring for match consumption
- background queue / worker execution outside the request lifecycle
- playlist-profile bootstrap from playlist descriptions (separate follow-up)
- Spotify playlist mutation and full automation of the post-match flow

## Decisions

### 1. A single shared batch is selected once per pipeline run

**Decision:** `runEnrichmentPipeline()` calls `selectPipelineBatch(accountId, batchSize)` once, then passes the resulting `PipelineBatch` to the stages that operate on liked-song candidates.

**Rationale:** This keeps all candidate-oriented stages aligned to the same recent-song window and avoids each stage re-querying a slightly different slice of liked songs.

### 2. The pipeline is dependency-ordered, with a parallel-safe prep phase

**Decision:** The orchestrator runs three prep stages together:

- `audio_features`
- `genre_tagging`
- `playlist_profiling`

Then it runs the dependent stages in order:

- `song_analysis`
- `song_embedding`
- `matching`

**Rationale:** The prep stages read from the selected batch or destination playlists and can make progress independently, while `song_embedding` depends on `song_analysis`, and `matching` depends on the outputs persisted by earlier stages.

**Trade-off:** `playlist_profiling` currently executes before any new song embeddings are generated for the current run, so first-run playlist profiles can still be sparse. That limitation is intentionally deferred to a follow-up bootstrap change.

### 3. Batch sizing uses `batchSize` plus environment overrides

**Decision:** `PipelineOptions` exposes `batchSize`, and the orchestrator resolves the final size from:

1. `PIPELINE_BATCH_SIZE`
2. legacy `PIPELINE_MAX_SONGS`
3. `options?.batchSize`
4. default `5`

**Rationale:** This preserves the original development cost guardrail while matching the current API and keeping backward compatibility with the earlier environment variable name.

### 4. The sync endpoint always returns structured pipeline output

**Decision:** `POST /api/extension/sync` always calls `runEnrichmentPipeline(accountId)` after Phase 3 and returns:

- `pipelineJobIds`
- `pipeline.stages`
- `pipeline.totalDurationMs`

If pipeline bootstrap fails before stage execution, the response still returns `ok: true` and surfaces a top-level `pipeline.error`.

**Rationale:** The UI needs a stable response shape whether the pipeline ran fully, skipped due to an empty batch, or failed before stages started.

### 5. Each stage still owns its own incremental filtering

**Decision:** The orchestrator chooses the candidate batch, but each stage decides which items are `ready`, `done`, or `notReady` based on persisted state.

**Implementation details:**
- `audio_features` skips songs already present in `song_audio_feature`
- `genre_tagging` skips songs that already have `song.genres`
- `song_analysis` skips songs that already have `song_analysis`
- `song_embedding` skips songs that already have `song_embedding`
- `playlist_profiling` relies on profile caching in `PlaylistProfilingService`
- `matching` skips liked songs that already have an action record via pending-song filtering

**Rationale:** This keeps stages idempotent and resilient to partial reruns.

### 6. Stage failures are inline; bootstrap failures are top-level

**Decision:** Stage-level failures are captured as `EnrichmentStageResult` items with `status: "failed"`, while pre-stage initialization failures return `Result.err(PipelineBootstrapError)` from the orchestrator.

**Rationale:** This mirrors the current code path and distinguishes “the pipeline started but a stage failed” from “the pipeline could not initialize at all.”

## Data flow

```text
POST /api/extension/sync
  → Phase 1: liked songs sync
  → Phase 2: playlists sync
  → Phase 3: playlist tracks (no-op)
  → Phase 4: enrichment pipeline
      → selectPipelineBatch(accountId, batchSize)
      → Phase A (parallel-safe prep)
          → audio_features
          → genre_tagging
          → playlist_profiling
      → Phase B
          → song_analysis
      → Phase C
          → song_embedding
      → Phase D
          → matching
  → Response: { ok, results, phaseJobIds, pipelineJobIds, pipeline }
```

## Risks / Trade-offs

**[Request timeout]** → The 5-song default keeps the request bounded, but full-library processing still needs a different execution model later.

**[First-run playlist profiles can be sparse]** → `playlist_profiling` currently runs before newly generated song embeddings for the current batch exist, and it only sees whatever enrichment already exists for destination playlist members. This is the main follow-up gap.

**[External API degradation]** → Audio features and genre enrichment degrade gracefully; matching can still proceed with adaptive weighting when some signals are missing.

**[Repeated match contexts]** → Each pipeline run creates a new `match_context`, so downstream consumers must query the latest context when presenting results.

## Open Questions

None for this change. The remaining known gap is the separate playlist-profile bootstrap follow-up.
