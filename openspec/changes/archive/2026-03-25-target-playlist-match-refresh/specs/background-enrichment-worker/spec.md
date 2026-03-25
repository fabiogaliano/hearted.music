## MODIFIED Requirements

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

## ADDED Requirements

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
