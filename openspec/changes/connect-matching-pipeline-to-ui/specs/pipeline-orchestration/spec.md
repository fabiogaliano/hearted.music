## ADDED Requirements

### Requirement: Post-sync enrichment pipeline

The system SHALL run an enrichment pipeline automatically after sync phases complete. The pipeline executes five stages sequentially: audio features, song analysis, song embeddings, playlist profiling, and matching.

#### Scenario: Pipeline triggers after successful sync
- **WHEN** the sync endpoint (`POST /api/extension/sync`) completes all three sync phases (liked songs, playlists, playlist tracks)
- **THEN** the system SHALL invoke `runEnrichmentPipeline(accountId, options)` before returning the response

#### Scenario: Pipeline runs within request lifecycle
- **WHEN** the pipeline is triggered
- **THEN** all stages execute sequentially within the same request
- **AND** pipeline results are included in the sync response under a `pipeline` field

#### Scenario: Pipeline skipped when no liked songs
- **WHEN** the account has zero liked songs after sync
- **THEN** the pipeline SHALL NOT run
- **AND** the response `pipeline` field SHALL be `null`

---

### Requirement: Sequential stage execution

The system SHALL execute pipeline stages in dependency order, where each stage's output feeds the next.

#### Scenario: Stage execution order
- **WHEN** the pipeline runs
- **THEN** stages execute in this order:
  1. Audio features (ReccoBeats)
  2. Song analysis (LLM)
  3. Song embeddings (ML provider)
  4. Playlist profiling (computed from embeddings + audio + genres)
  5. Matching (MatchingService.matchBatch)

#### Scenario: Stage dependency enforcement
- **WHEN** a stage fails completely (zero successes)
- **THEN** subsequent stages that depend on its output SHALL still attempt to run
- **AND** those stages will naturally process fewer items (since prerequisite data is missing)

#### Scenario: Partial stage failure
- **WHEN** a stage succeeds for some items but fails for others
- **THEN** the pipeline SHALL continue to the next stage
- **AND** subsequent stages process only the items that have prerequisite data

---

### Requirement: Batch size cap

The system SHALL limit the number of songs processed per pipeline run.

#### Scenario: Default batch cap
- **WHEN** no explicit limit is configured
- **THEN** the pipeline SHALL process at most 5 songs per run

#### Scenario: Configurable cap via environment
- **WHEN** `PIPELINE_MAX_SONGS` environment variable is set
- **THEN** the pipeline SHALL use that value as the batch cap

#### Scenario: Songs selected for processing
- **WHEN** the batch cap is less than the total number of unprocessed songs
- **THEN** the pipeline SHALL select the most recently liked songs first (ordered by `liked_at` descending)

---

### Requirement: Incremental processing

Each pipeline stage SHALL only process items that have not already been processed, making the pipeline idempotent and safe to re-run.

#### Scenario: Audio features — skip already fetched
- **WHEN** the audio features stage runs
- **THEN** it SHALL only fetch features for songs that have no row in `song_audio_feature`

#### Scenario: Analysis — skip already analyzed
- **WHEN** the analysis stage runs
- **THEN** it SHALL only analyze songs that have no row in `song_analysis`
- **AND** it SHALL use `AnalysisPipeline.getSongsNeedingAnalysis()` for this filtering

#### Scenario: Embeddings — skip already embedded
- **WHEN** the embedding stage runs
- **THEN** it SHALL only embed songs that have a `song_analysis` row but no `song_embedding` row

#### Scenario: Profiling — skip up-to-date profiles
- **WHEN** the profiling stage runs
- **THEN** it SHALL only recompute profiles for destination playlists whose `content_hash` has changed or that have no existing profile

#### Scenario: Matching — process unactioned songs only
- **WHEN** the matching stage runs
- **THEN** it SHALL match songs that have no `item_status` action record (not yet added, dismissed, or skipped)
- **AND** it SHALL match against all destination playlists that have a `playlist_profile`

---

### Requirement: Per-stage job tracking

Each pipeline stage SHALL create a job record for progress tracking via SSE.

#### Scenario: Job creation per stage
- **WHEN** a pipeline stage begins
- **THEN** it SHALL create a job with the appropriate `job_type` (e.g., `song_analysis`, `matching`)
- **AND** transition it through `pending → running → completed/failed`

#### Scenario: SSE progress events
- **WHEN** a stage processes items
- **THEN** it SHALL emit progress events via `emitProgress()` and `emitItem()`
- **AND** clients subscribed to `/api/jobs/$id/progress` SHALL receive these events

#### Scenario: Pipeline job IDs in response
- **WHEN** the pipeline completes
- **THEN** the sync response SHALL include all pipeline job IDs so the UI can subscribe to their progress

---

### Requirement: Non-fatal pipeline failures

Pipeline failures SHALL NOT cause the sync response to fail.

#### Scenario: Stage failure is logged and skipped
- **WHEN** a pipeline stage throws or returns an error
- **THEN** the error SHALL be logged
- **AND** the pipeline SHALL continue to the next stage
- **AND** the sync response SHALL still return `ok: true`

#### Scenario: Pipeline errors reported in response
- **WHEN** one or more stages fail
- **THEN** the response `pipeline` field SHALL include `errors` array with stage name and error message for each failure

#### Scenario: All stages fail
- **WHEN** every pipeline stage fails
- **THEN** the sync response SHALL still return `ok: true` with sync results
- **AND** `pipeline.errors` SHALL contain all failures

---

### Requirement: Orchestrator module location

The pipeline orchestrator SHALL be located under the capabilities folder.

#### Scenario: Module location
- **WHEN** the orchestrator is created
- **THEN** it SHALL reside at `src/lib/capabilities/pipeline/orchestrator.ts`

#### Scenario: Function signature
- **WHEN** the orchestrator is invoked
- **THEN** it SHALL be called via `runEnrichmentPipeline(accountId: string, options?: PipelineOptions): Promise<Result<PipelineRunResult, PipelineRunError>>`
