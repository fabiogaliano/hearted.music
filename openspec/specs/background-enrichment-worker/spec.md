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

