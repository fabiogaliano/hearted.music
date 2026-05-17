# background-enrichment-worker Specification

## Purpose
TBD - created by archiving change add-background-enrichment-worker. Update Purpose after archive.
## Requirements
### Requirement: Durable background enrichment execution

The system SHALL execute liked-song enrichment as queued background work claimed from the Supabase `job` table by a Bun worker running on the VPS, and SHALL report explicit outcomes back to the library-processing control plane.

#### Scenario: Sync queues enrichment without waiting for execution
- **WHEN** `POST /api/extension/sync` finishes its persistence phases successfully and library-processing marks `enrichment` stale
- **THEN** the system SHALL create or reuse an active `enrichment` job for the account
- **AND** the sync request SHALL return successfully without waiting for enrichment stages to complete

#### Scenario: Target playlist save queues enrichment without blocking the save response
- **WHEN** onboarding saves one or more target playlists and library-processing determines candidate-side liked-song work is still owed
- **THEN** the system SHALL create or reuse an active `enrichment` job for the account
- **AND** the save response SHALL complete without waiting for the background job to finish

#### Scenario: Worker executes only liked-song enrichment stages for each claimed chunk
- **WHEN** the worker claims an `enrichment` job
- **THEN** it SHALL attempt `audio_features`, `genre_tagging`, `song_analysis`, and `song_embedding` for that chunk
- **AND** it SHALL write per-song pipeline processing state for completed chunk items
- **AND** it SHALL NOT publish `match_context` or `match_result` as part of chunk execution

#### Scenario: Worker reports explicit enrichment completion outcomes
- **WHEN** an enrichment chunk finishes successfully
- **THEN** the worker SHALL apply an `enrichment_completed` change carrying `requestSatisfied` and `newCandidatesAvailable`
- **AND** it SHALL NOT directly chain another job or request refresh outside the library-processing control plane

#### Scenario: Worker reports explicit enrichment stop outcomes
- **WHEN** enrichment stops because of a local cap or an error
- **THEN** the worker SHALL apply `enrichment_stopped` with `reason = local_limit | error`
- **AND** it SHALL let library-processing decide whether more work is still owed

#### Scenario: Request satisfaction comes from chunk completion state
- **WHEN** the worker determines whether a completed chunk satisfied the current enrichment request
- **THEN** it SHALL use chunk completion state and a follow-up selector probe such as `hasMoreSongs`
- **AND** it SHALL NOT rely on timer-based polling or active-job counts to infer request satisfaction

### Requirement: Durable target-playlist refresh execution

The system SHALL execute match snapshot refresh as queued background work claimed from the Supabase `job` table by the same Bun worker.

#### Scenario: Follow-on refresh queues without blocking the caller
- **WHEN** library-processing determines `matchSnapshotRefresh` is stale
- **THEN** the system SHALL create or reuse an active `match_snapshot_refresh` job for the account
- **AND** the caller SHALL return without waiting for the refresh job to finish

#### Scenario: Worker executes refresh through a dedicated single-pass handler
- **WHEN** the worker claims a `match_snapshot_refresh` job
- **THEN** it SHALL execute the dedicated match snapshot refresh workflow for that account as a single pass
- **AND** that workflow SHALL be the only background path allowed to publish match snapshots

#### Scenario: Queue ordering follows queue priority
- **WHEN** pending `enrichment` and `match_snapshot_refresh` jobs coexist in the worker queue
- **THEN** claim order SHALL prefer higher `queue_priority` first and older `created_at` second
- **AND** the worker SHALL NOT hardcode enrichment-before-refresh priority outside the database claim path

### Requirement: Atomic refresh job claiming and recovery

The worker SHALL use atomic claim semantics and explicit crash recovery for queued `match_snapshot_refresh` jobs.

#### Scenario: Only one worker instance claims a pending refresh job
- **WHEN** multiple worker instances poll for pending `match_snapshot_refresh` jobs concurrently
- **THEN** each pending refresh job SHALL be claimed by at most one worker
- **AND** claim order SHALL prefer higher `queue_priority` first and older `created_at` second

#### Scenario: Running refresh jobs maintain a heartbeat
- **WHEN** a worker is executing a `match_snapshot_refresh` job
- **THEN** it SHALL update `heartbeat_at` periodically on the running job row
- **AND** the job SHALL remain in `running` status until it completes, fails, or is swept as stale

#### Scenario: Stale refresh jobs recover safely
- **WHEN** a `match_snapshot_refresh` job remains stale beyond the configured threshold without heartbeat updates
- **THEN** the sweep process SHALL reset that job back to `pending` if its attempts remain below `max_attempts`
- **AND** exhausted stale refresh jobs SHALL be marked `failed` instead of retried forever

### Requirement: Atomic job claiming and recovery

The worker SHALL use atomic claim semantics and explicit crash recovery for queued enrichment jobs.

#### Scenario: Only one worker instance claims a pending job
- **WHEN** multiple worker instances poll for pending `enrichment` jobs concurrently
- **THEN** each pending job SHALL be claimed by at most one worker
- **AND** claim order SHALL prefer higher `queue_priority` first and older `created_at` second

#### Scenario: Running jobs maintain a heartbeat
- **WHEN** a worker is executing an `enrichment` job
- **THEN** it SHALL update `heartbeat_at` periodically on the running job row
- **AND** the job SHALL remain in `running` status until it completes, fails, or is swept as stale

#### Scenario: Stale retryable jobs are reset
- **WHEN** an `enrichment` job remains `running` beyond the configured stale threshold without heartbeat updates
- **THEN** the sweep process SHALL reset that job back to `pending` if its attempts remain below `max_attempts`
- **AND** a later worker poll SHALL be able to claim it again

#### Scenario: Exhausted stale jobs are dead-lettered
- **WHEN** an `enrichment` job remains stale and its attempts have reached `max_attempts`
- **THEN** the sweep process SHALL mark the job `failed`
- **AND** the job SHALL not be retried automatically again

### Requirement: Graceful shutdown and draining

The worker SHALL stop claiming new jobs during shutdown and preserve safe recovery for work that does not finish before process exit.

#### Scenario: Shutdown stops new claims
- **WHEN** the worker receives a termination signal
- **THEN** it SHALL stop polling for and claiming new `enrichment` jobs
- **AND** it SHALL enter shutdown mode for already-claimed work

#### Scenario: In-flight jobs may drain before exit
- **WHEN** the worker has already claimed one or more `enrichment` jobs when shutdown begins
- **THEN** it SHALL allow those in-flight job handlers to finish within the configured shutdown timeout
- **AND** jobs that finish during that drain period SHALL persist their final status and progress before process exit

#### Scenario: Interrupted shutdown remains recoverable
- **WHEN** the worker exits or is terminated before an in-flight `enrichment` job finishes
- **THEN** that job SHALL be recovered by the stale-job sweep flow according to `attempts` and `max_attempts`
- **AND** a later worker poll SHALL be able to resume the queue safely

### Requirement: Chunked fairness with onboarding-first progression

The system SHALL process enrichment as chunked jobs that interleave fairly across accounts while leaving follow-up job ensuring to library-processing.

#### Scenario: Onboarding uses exponential early chunk sizes
- **WHEN** an account is processing its first background enrichment chunks
- **THEN** chunk sizes SHALL progress as `1`, `5`, `10`, `25`, `50`
- **AND** subsequent chunks for that account SHALL use size `50`

#### Scenario: Remaining work chains to the queue tail
- **WHEN** an enrichment pass settles and more liked-song work remains for the account
- **THEN** library-processing SHALL ensure the next `enrichment` chunk as a new pending job
- **AND** that successor chunk SHALL be appended to the queue tail so other accounts can interleave naturally

#### Scenario: Only one active enrichment chain exists per account
- **WHEN** sync, onboarding, or a worker outcome requests more enrichment for an account that already has a pending or running `enrichment` job
- **THEN** the system SHALL reuse the existing active job chain
- **AND** it SHALL NOT create a duplicate active enrichment job for the same account

### Requirement: Persisted chunk progress for polling

Each queued enrichment chunk SHALL persist its own stage progress in the `job.progress` payload so clients can poll it safely across process boundaries.

#### Scenario: Chunk progress stores stage-level visibility
- **WHEN** a worker-owned `enrichment` job begins or advances through stages
- **THEN** `job.progress` SHALL include aggregate counts (`total`, `done`, `succeeded`, `failed`)
- **AND** it SHALL include the current stage, per-stage status/counts, `batchSize`, and `batchSequence`

#### Scenario: Background progress can be polled from persisted state
- **WHEN** the web app needs background enrichment progress
- **THEN** it SHALL be able to read `status`, `progress`, and `error` from the persisted `job` row
- **AND** it SHALL NOT depend on an in-memory SSE emitter or Supabase Realtime to observe worker progress

### Requirement: Terminal per-song failure exclusion

The worker SHALL record terminal per-song failures and exclude those songs from automatic background reprocessing until they are explicitly retried or cleared.

#### Scenario: Terminal song failure is recorded
- **WHEN** a song fails enrichment with a non-retryable error classification
- **THEN** the system SHALL record that failure against the current job and song item
- **AND** the failure record SHALL remain queryable for operator visibility

#### Scenario: Terminally failed songs are skipped by later chunk selection
- **WHEN** future chunks are selected for the same account
- **THEN** songs previously marked with terminal enrichment failures SHALL be excluded from automatic chunk selection
- **AND** other eligible songs SHALL continue processing normally

#### Scenario: Manual retry re-enables a terminally failed song
- **WHEN** an operator or future retry flow clears a song's terminal failure state
- **THEN** that song SHALL become eligible for later chunk selection again

### Requirement: Process-wide provider rate limiting

Concurrent background jobs running in the same worker process SHALL share one limiter per external provider.

#### Scenario: Provider limiter is shared across concurrent jobs
- **WHEN** multiple `enrichment` jobs run concurrently in the same Bun worker process
- **THEN** requests sent to a given provider SHALL respect a single shared limiter for that provider
- **AND** creating a second job SHALL NOT multiply that provider's effective request concurrency

#### Scenario: Providers keep distinct limits
- **WHEN** the worker configures limiters for ReccoBeats, Last.fm, Genius, the LLM provider, and embedding providers
- **THEN** each provider SHALL be allowed to use settings appropriate to its own rate limits
- **AND** one provider's limiter SHALL NOT override another provider's settings

### Requirement: Durable execution measurement

The system SHALL record one durable measurement row per claimed `enrichment` or `match_snapshot_refresh` job attempt.

#### Scenario: Claimed attempts write shared execution measurement fields
- **WHEN** a worker claims an `enrichment` or `match_snapshot_refresh` job attempt
- **THEN** the system SHALL persist shared measurement fields including `job_id`, `account_id`, `workflow`, `queue_priority`, `attempt_number`, `queued_at`, `started_at`, `finished_at`, and `outcome`
- **AND** retries SHALL create additional measurement rows rather than overwriting earlier attempts

#### Scenario: Enrichment measurements capture per-stage summaries
- **WHEN** an `enrichment` attempt finishes
- **THEN** its measurement details SHALL record a small per-stage summary including `readyCount`, `doneCount`, `succeededCount`, and `failedCount`
- **AND** that summary SHALL reflect the attempted chunk rather than the entire account history

#### Scenario: Match snapshot refresh measurements capture publish results
- **WHEN** a `match_snapshot_refresh` attempt finishes
- **THEN** its measurement details SHALL record `published` and `isEmpty`
- **AND** the measurement SHALL remain durable even when publication is a no-op because the snapshot was already current

### Requirement: Enrichment stages report structured per-song outcomes

Each enrichment stage SHALL report attempted, succeeded, skipped, and failed song IDs through a structured outcome interface, and the worker SHALL derive progress counts from those IDs.

#### Scenario: Stage success resolves prior non-terminal failures
- **WHEN** a stage reports one or more succeeded song IDs
- **THEN** the stage accounting module SHALL resolve prior unresolved non-terminal failure rows for those song IDs and that stage
- **AND** the stage implementation SHALL NOT duplicate that resolution logic inline

#### Scenario: Stage failures create durable failure rows
- **WHEN** a stage reports failed song IDs with failure codes
- **THEN** the stage accounting module SHALL record durable `job_item_failure` rows for each failed song
- **AND** failure policy SHALL decide terminal status and suppression windows from the centralized failure-policy module

#### Scenario: Progress counts are derived from structured outcomes
- **WHEN** a stage outcome is finalized
- **THEN** the job progress summary SHALL derive `total`, `succeeded`, and `failed` from the finalized outcome
- **AND** it SHALL NOT rely on stage-local ad-hoc count objects as the source of truth

#### Scenario: Illegal outcome shapes are rejected
- **WHEN** a stage reports the same song ID as both succeeded and failed
- **THEN** the system SHALL reject the outcome in tests and development mode
- **AND** it SHALL treat the rejected outcome as a stage accounting error rather than a successful stage

### Requirement: Stage-wide exceptions expand to per-candidate retryable failures

The worker SHALL convert a thrown stage handler into per-song retryable failures for every candidate offered to that stage.

#### Scenario: Thrown stage does not undercount failures
- **WHEN** a stage handler throws before returning an outcome
- **AND** the orchestrator offered N candidate song IDs to that stage
- **THEN** the finalized stage summary SHALL report N failed items
- **AND** the system SHALL record a non-terminal failure row for each candidate song ID

#### Scenario: Thrown stage preserves operational context
- **WHEN** a stage-wide exception is converted into per-song failures
- **THEN** each failure row SHALL include the stage name, a retryable failure code, and the original error message when available
- **AND** future selector passes SHALL honor the resulting suppression window

### Requirement: Stage accounting persistence is required for successful progress

The worker SHALL only report stage progress as successful after the durable stage accounting path has completed.

#### Scenario: Failure-row persistence failure fails the parent attempt
- **WHEN** a stage outcome includes failed song IDs
- **AND** the accounting module cannot persist the required `job_item_failure` rows or suppression state
- **THEN** the parent enrichment attempt SHALL fail rather than return success-shaped stage counts
- **AND** the runner SHALL handle the attempt through the normal failed-job settlement path

#### Scenario: Prior-failure resolution failure is not hidden by successes
- **WHEN** a stage outcome includes succeeded song IDs with prior non-terminal failures
- **AND** resolving those prior failure rows fails
- **THEN** the stage accounting result SHALL be an error
- **AND** the job progress SHALL NOT claim those successes as durably finalized

### Requirement: Parent enrichment job owns all worker-stage accounting

A worker-claimed `enrichment` job SHALL be the only job row used for the chunk's stage progress, failure rows, and execution measurement.

#### Scenario: Song analysis inside enrichment does not create child jobs
- **WHEN** the `song_analysis` stage runs as part of a worker-claimed `enrichment` job
- **THEN** it SHALL use the parent enrichment job ID for failure rows and progress
- **AND** it SHALL NOT create a standalone `song_analysis` job row for that stage run

#### Scenario: Execution measurement summarizes the parent chunk
- **WHEN** an enrichment attempt finishes
- **THEN** the execution measurement SHALL summarize the parent enrichment chunk
- **AND** child stage internals SHALL NOT create separate job measurements for the same chunk

### Requirement: Content activation is an accounted enrichment stage

The content activation step SHALL be represented as an enrichment stage with progress, durable failures, and retry behavior.

#### Scenario: Successful activation marks offered songs succeeded
- **WHEN** content activation persists the account-visible state required for offered song IDs
- **THEN** the content activation outcome SHALL report those song IDs as succeeded
- **AND** prior non-terminal `content_activation` failures for those IDs SHALL be resolved

#### Scenario: Activation persistence failure is retryable
- **WHEN** item-status persistence, unlimited activation RPC, or self-hosted unlock persistence fails for offered song IDs
- **THEN** the content activation outcome SHALL report retryable failures for those song IDs
- **AND** the failure code SHALL suppress immediate hot retries without marking the songs terminal

#### Scenario: Missing subscription provenance does not silently activate
- **WHEN** an account has subscription unlimited access but required subscription provenance is missing
- **THEN** content activation SHALL report retryable failures for the offered song IDs
- **AND** it SHALL NOT silently fall back to item-status-only activation for those IDs

### Requirement: Worker recovery repairs terminal library-processing active refs

The worker SHALL repair `library_processing_state` active-job references that point at terminal library-processing jobs so stale workflows do not remain wedged behind completed or failed job rows.

#### Scenario: Dead-lettered enrichment job clears active reference
- **WHEN** the stale-job sweep marks an `enrichment` job as `failed` because it exhausted attempts
- **THEN** the worker SHALL apply the corresponding library-processing failure change
- **AND** the enrichment workflow's active job reference SHALL be cleared
- **AND** the enrichment workflow SHALL remain stale rather than being marked settled

#### Scenario: Dead-lettered refresh job clears active reference
- **WHEN** the stale-job sweep marks a `match_snapshot_refresh` job as `failed` because it exhausted attempts
- **THEN** the worker SHALL apply the corresponding library-processing failure change
- **AND** the match snapshot refresh workflow's active job reference SHALL be cleared
- **AND** the workflow SHALL remain stale rather than being marked settled

#### Scenario: Startup recovery handles pre-existing failed active refs
- **WHEN** the worker starts and finds a `library_processing_state` active job reference that points at a failed `enrichment` or `match_snapshot_refresh` job
- **THEN** the worker SHALL repair that state through the same library-processing change interface used by normal worker outcomes
- **AND** the worker SHALL NOT update `library_processing_state` directly outside that interface

#### Scenario: Completed active refs are reconstructed from durable measurements
- **WHEN** the worker finds an active job reference pointing at a completed library-processing job that was not settled in state
- **THEN** the worker SHALL reconstruct the settlement change from the terminal job row and durable execution measurement details when possible
- **AND** if the measurement details are missing or invalid, it SHALL clear the active reference conservatively and leave the workflow stale for later retry

### Requirement: Worker sweep orchestration is testable without process startup

The worker SHALL expose sweep, dead-letter, and recovery orchestration through a module seam that can be exercised by tests without launching the full Bun worker process.

#### Scenario: Sweep tick invokes stale reset and dead-letter passes
- **WHEN** the sweep tick runs
- **THEN** it SHALL call the stale reset and dead-letter operations for library-processing jobs
- **AND** it SHALL call the equivalent stale reset and dead-letter operations for walkthrough preview jobs

#### Scenario: Dead-letter results feed recovery
- **WHEN** a sweep tick receives dead-lettered library-processing jobs
- **THEN** it SHALL pass each dead-lettered job to the library-processing recovery module
- **AND** recovery failures SHALL be logged as structured errors without preventing the remaining jobs from being processed

### Requirement: Job work modules expose role-specific interfaces

Job work orchestration SHALL be organized behind role-specific module interfaces instead of one shallow catch-all job data module.

#### Scenario: Raw job row operations are separate from queue policy
- **WHEN** code needs to read, update, heartbeat, or mark a job row terminal
- **THEN** it SHALL import from the raw job repository module
- **AND** it SHALL NOT need to import queue claim, sweep, or workflow ensure helpers

#### Scenario: Library-processing queue policy is separate from sync phase jobs
- **WHEN** worker polling claims, sweeps, or dead-letters `enrichment` and `match_snapshot_refresh` jobs
- **THEN** it SHALL import from the library-processing queue module
- **AND** sync-phase jobs SHALL use a separate interface that does not expose worker-claimed queue policy

#### Scenario: Walkthrough preview queue policy stays isolated
- **WHEN** worker polling claims or recovers `walkthrough_match_preview` jobs
- **THEN** it SHALL use the walkthrough preview queue module
- **AND** walkthrough preview queue behavior SHALL NOT share active-job state with production library-processing workflows

