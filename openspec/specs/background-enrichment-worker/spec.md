# background-enrichment-worker Specification

## Purpose
TBD - created by archiving change add-background-enrichment-worker. Update Purpose after archive.
## Requirements
### Requirement: Durable background enrichment execution

The system SHALL execute liked-song enrichment as queued background work claimed from the Supabase `job` table by a Bun worker running on the VPS, and SHALL delegate published suggestion refreshes to a separate target-playlist refresh job.

#### Scenario: Sync queues enrichment without waiting for execution
- **WHEN** `POST /api/extension/sync` finishes its persistence phases successfully
- **THEN** the system SHALL create or reuse an active `enrichment` job for the account when liked-song candidate-side enrichment work is needed
- **AND** the sync request SHALL return successfully without waiting for enrichment stages to complete

#### Scenario: Target playlist save queues enrichment without blocking the save response
- **WHEN** onboarding saves one or more target playlists and candidate-side liked-song enrichment follow-on work is needed
- **THEN** the system SHALL create or reuse an active `enrichment` job for the account
- **AND** the save response SHALL complete without waiting for the background job to finish

#### Scenario: Worker executes only liked-song enrichment stages for each claimed chunk
- **WHEN** the worker claims an `enrichment` job
- **THEN** it SHALL attempt `audio_features`, `genre_tagging`, `song_analysis`, and `song_embedding` for that chunk
- **AND** it SHALL write per-song pipeline processing state for completed chunk items
- **AND** it SHALL NOT publish `match_context` or `match_result` as part of chunk execution

#### Scenario: Queue drain requests target-playlist refresh for active target sets
- **WHEN** an enrichment chunk completes, no more liked-song enrichment work remains for the account, and the account currently has one or more target playlists selected
- **THEN** the worker SHALL create or reuse a `target_playlist_match_refresh` job for that account
- **AND** it SHALL use refresh follow-on work instead of publishing a chunk-level snapshot directly

#### Scenario: Queue drain skips refresh when no target playlists exist yet
- **WHEN** an enrichment chunk completes, no more liked-song enrichment work remains for the account, and the account currently has zero target playlists selected
- **THEN** the worker SHALL NOT enqueue `target_playlist_match_refresh` for enrichment-drain alone
- **AND** it SHALL still persist liked-song pipeline processing state for the completed chunk

#### Scenario: Queue drain detection comes from chunk completion
- **WHEN** the worker decides whether liked-song enrichment work has drained for an account
- **THEN** it SHALL use the claimed chunk's completion result such as `hasMoreSongs = false`
- **AND** it SHALL NOT rely on timer-based polling or active-job counts to infer drain completion

### Requirement: Durable target-playlist refresh execution

The system SHALL execute target-playlist refresh as queued background work claimed from the Supabase `job` table by the same Bun worker.

#### Scenario: Follow-on refresh queues without blocking the caller
- **WHEN** sync, onboarding, manual actions, or enrichment drain request target-playlist refresh
- **THEN** the system SHALL create or reuse an active `target_playlist_match_refresh` job for the account
- **AND** the caller SHALL return without waiting for the refresh job to finish

#### Scenario: Worker executes refresh through a dedicated handler
- **WHEN** the worker claims a `target_playlist_match_refresh` job
- **THEN** it SHALL execute the dedicated target-playlist refresh workflow for that account
- **AND** that workflow SHALL be the only background path allowed to publish match snapshots

#### Scenario: Worker priority prefers enrichment before refresh
- **WHEN** pending `enrichment` and `target_playlist_match_refresh` jobs both exist
- **THEN** the worker SHALL claim `enrichment` jobs before `target_playlist_match_refresh` jobs
- **AND** that priority SHALL NOT allow enrichment jobs to publish match snapshots directly

### Requirement: Atomic refresh job claiming and recovery

The worker SHALL use atomic claim semantics and explicit crash recovery for queued `target_playlist_match_refresh` jobs.

#### Scenario: Only one worker instance claims a pending refresh job
- **WHEN** multiple worker instances poll for pending `target_playlist_match_refresh` jobs concurrently
- **THEN** each pending refresh job SHALL be claimed by at most one worker
- **AND** claim order SHALL prefer the oldest pending job first

#### Scenario: Running refresh jobs maintain a heartbeat
- **WHEN** a worker is executing a `target_playlist_match_refresh` job
- **THEN** it SHALL update `heartbeat_at` periodically on the running job row
- **AND** the job SHALL remain in `running` status until it completes, fails, or is swept as stale

#### Scenario: Stale refresh jobs recover safely
- **WHEN** a `target_playlist_match_refresh` job remains stale beyond the configured threshold without heartbeat updates
- **THEN** the sweep process SHALL reset that job back to `pending` if its attempts remain below `max_attempts`
- **AND** exhausted stale refresh jobs SHALL be marked `failed` instead of retried forever

### Requirement: Atomic job claiming and recovery

The worker SHALL use atomic claim semantics and explicit crash recovery for queued enrichment jobs.

#### Scenario: Only one worker instance claims a pending job
- **WHEN** multiple worker instances poll for pending `enrichment` jobs concurrently
- **THEN** each pending job SHALL be claimed by at most one worker
- **AND** claim order SHALL prefer the oldest pending job first

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

The system SHALL process enrichment as chunked jobs that interleave fairly across accounts.

#### Scenario: Onboarding uses exponential early chunk sizes
- **WHEN** an account is processing its first background enrichment chunks
- **THEN** chunk sizes SHALL progress as `1`, `5`, `10`, `25`, `50`
- **AND** subsequent chunks for that account SHALL use size `50`

#### Scenario: Remaining work chains to the queue tail
- **WHEN** a chunk completes and unenriched songs still remain for the account
- **THEN** the worker SHALL enqueue the next `enrichment` chunk as a new pending job
- **AND** that successor chunk SHALL be appended to the end of the queue so other accounts can interleave naturally

#### Scenario: Only one active enrichment chain exists per account
- **WHEN** sync, onboarding, or another trigger requests background enrichment for an account that already has a pending or running `enrichment` job
- **THEN** the system SHALL reuse the existing active job chain
- **AND** it SHALL NOT create a duplicate active chain for the same account

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

