## ADDED Requirements

### Requirement: Post-sync enrichment pipeline

The system SHALL run an enrichment pipeline automatically after sync phases complete.

#### Scenario: Pipeline triggers after successful sync
- **WHEN** the sync endpoint (`POST /api/extension/sync`) completes all three sync phases (liked songs, playlists, playlist tracks)
- **THEN** the system SHALL invoke `runEnrichmentPipeline(accountId, options?)` before returning the response

#### Scenario: Pipeline reruns after destination selection changes
- **WHEN** onboarding saves one or more destination playlists for the account
- **THEN** the system MAY invoke `runEnrichmentPipeline(accountId, options?)` again so destination-dependent stages can run with the updated playlist selection

#### Scenario: Pipeline runs within request lifecycle
- **WHEN** the pipeline is triggered
- **THEN** all pipeline work SHALL run within the same request lifecycle
- **AND** the sync response SHALL NOT need to expose pipeline-specific result payload

#### Scenario: Empty candidate batch
- **WHEN** `selectPipelineBatch()` returns zero liked songs
- **THEN** the pipeline SHALL return a structured result with all stages marked `skipped`
- **AND** the sync response SHALL still return successfully without exposing pipeline-specific payload

---

#### Scenario: Destination playlists not selected yet
- **WHEN** onboarding has not yet saved any destination playlists
- **THEN** `playlist_profiling` and `matching` MAY return `status: "skipped"`
- **AND** the skip reason SHALL reflect that no destination playlists have been selected yet

---

### Requirement: Dependency-ordered stage execution

The system SHALL execute pipeline stages in dependency order, allowing safe parallelism where stages do not depend on each other.

#### Scenario: Stage execution order
- **WHEN** the pipeline runs
- **THEN** it SHALL execute the following phases:
  1. Phase A prep: `audio_features`, `genre_tagging`, and `playlist_profiling`
  2. Phase B: `song_analysis`
  3. Phase C: `song_embedding`
  4. Phase D: `matching`

#### Scenario: Parallel-safe prep phase
- **WHEN** Phase A begins
- **THEN** `audio_features`, `genre_tagging`, and `playlist_profiling` MAY run concurrently
- **AND** each SHALL produce its own independent stage result

#### Scenario: Downstream execution after failures
- **WHEN** a stage fails completely or partially
- **THEN** subsequent dependent stages SHALL still attempt to run
- **AND** they SHALL naturally process fewer items when prerequisite data is missing

---

### Requirement: Batch size cap

The system SHALL limit the number of liked songs processed per pipeline run.

#### Scenario: Default batch cap
- **WHEN** no override is configured
- **THEN** the pipeline SHALL process at most 5 liked songs per run

#### Scenario: Configurable cap via environment
- **WHEN** `PIPELINE_BATCH_SIZE` environment variable is set
- **THEN** the pipeline SHALL use that value as the batch cap

#### Scenario: Legacy environment fallback
- **WHEN** `PIPELINE_BATCH_SIZE` is absent and `PIPELINE_MAX_SONGS` is set
- **THEN** the pipeline SHALL use `PIPELINE_MAX_SONGS` as a legacy fallback

#### Scenario: Songs selected for processing
- **WHEN** the batch cap is less than the total number of liked songs
- **THEN** the pipeline SHALL select the most recently liked songs first (ordered by `liked_at` descending)

---

### Requirement: Incremental processing

Each pipeline stage SHALL only process items that are still missing that stage's output, making the pipeline safe to re-run.

#### Scenario: Audio features — skip already fetched
- **WHEN** the audio features stage runs
- **THEN** it SHALL only fetch features for songs that have no row in `song_audio_feature`

#### Scenario: Genre tagging — skip already tagged
- **WHEN** the genre tagging stage runs
- **THEN** it SHALL only fetch genres for songs whose `song.genres` is empty or null

#### Scenario: Analysis — skip already analyzed
- **WHEN** the analysis stage runs
- **THEN** it SHALL only analyze songs that have no row in `song_analysis`
- **AND** it SHALL use `AnalysisPipeline.getSongsNeedingAnalysis()` for this filtering

#### Scenario: Embeddings — skip already embedded
- **WHEN** the embedding stage runs
- **THEN** it SHALL only embed songs that have a `song_analysis` row but no `song_embedding` row

#### Scenario: Profiling — rely on profile caching
- **WHEN** the profiling stage runs
- **THEN** it SHALL call `PlaylistProfilingService.computeProfile()` for each destination playlist
- **AND** profile reuse SHALL be determined by the profiling service cache

#### Scenario: Matching — process pending songs only
- **WHEN** the matching stage runs
- **THEN** it SHALL only match liked songs that are still pending action
- **AND** it SHALL match against destination playlists returned from the profiling stage that also have a stored profile

---

### Requirement: Per-stage job tracking

Each pipeline stage that executes work SHALL create a job record for progress tracking via SSE.

#### Scenario: Job creation per stage
- **WHEN** a tracked pipeline stage begins
- **THEN** it SHALL create a job with the appropriate `job_type`
- **AND** transition it through `pending → running → completed/failed`

#### Scenario: SSE progress events
- **WHEN** a stage processes items
- **THEN** it SHALL emit progress events via existing job progress helpers
- **AND** clients subscribed to `/api/jobs/$id/progress` SHALL receive those events

#### Scenario: Stage jobs remain internal to pipeline execution
- **WHEN** the pipeline completes or skips due to an empty batch
- **THEN** any stage job IDs MAY remain internal to pipeline execution
- **AND** the extension sync response SHALL not need to expose them

---

### Requirement: Non-fatal pipeline failures

Pipeline failures SHALL NOT cause the sync response to fail.

#### Scenario: Stage failure is reported inline
- **WHEN** a pipeline stage throws or returns an error after the pipeline has started
- **THEN** the stage SHALL be represented in the internal orchestrator result with `status: "failed"`
- **AND** the pipeline SHALL continue to the next stage
- **AND** the sync response SHALL still return `ok: true`

#### Scenario: Bootstrap failure is reported at the pipeline level
- **WHEN** the orchestrator cannot initialize before any stage runs
- **THEN** the sync response SHALL still return `ok: true`
- **AND** the failure MAY be logged internally without changing the extension response payload

---

### Requirement: Orchestrator module location

The pipeline orchestrator SHALL be located under the workflows folder.

#### Scenario: Module location
- **WHEN** the orchestrator is created
- **THEN** it SHALL reside at `src/lib/workflows/enrichment-pipeline/orchestrator.ts`

#### Scenario: Function signature
- **WHEN** the orchestrator is invoked
- **THEN** it SHALL be called via `runEnrichmentPipeline(accountId: string, options?: PipelineOptions): Promise<Result<EnrichmentRunResult, PipelineBootstrapError>>`
