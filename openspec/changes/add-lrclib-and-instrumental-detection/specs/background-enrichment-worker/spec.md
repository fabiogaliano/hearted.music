## MODIFIED Requirements

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

- **WHEN** an enrichment chunk finishes successfully having attempted at least one song
- **THEN** the worker SHALL apply an `enrichment_completed` change carrying `requestSatisfied` and `newCandidatesAvailable`
- **AND** it SHALL NOT directly chain another job or request refresh outside the library-processing control plane

#### Scenario: Worker reports explicit enrichment stop outcomes

- **WHEN** enrichment stops because of a local cap, an error, or a blocked chunk
- **THEN** the worker SHALL apply `enrichment_stopped` with `reason = local_limit | error | blocked`
- **AND** it SHALL let library-processing decide whether more work is still owed

#### Scenario: Blocked chunks stop instead of completing-unsatisfied

- **WHEN** a chunk finishes having attempted zero songs across all stages
- **AND** the post-chunk selector probe still reports work owed for the account
- **THEN** the worker SHALL apply `enrichment_stopped` with `reason = blocked` instead of `enrichment_completed` with `requestSatisfied = false`
- **AND** the workflow SHALL remain stale without an immediate re-ensure, preventing a no-progress hot loop

#### Scenario: Request satisfaction comes from chunk completion state

- **WHEN** the worker determines whether a completed chunk satisfied the current enrichment request
- **THEN** it SHALL use chunk completion state and a follow-up selector probe such as `hasMoreSongs`
- **AND** it SHALL NOT rely on timer-based polling or active-job counts to infer request satisfaction

## ADDED Requirements

### Requirement: Chunk selection requires stage inputs and honors suppression for every stage

The chunk selector SHALL flag a song for a stage only when that stage could actually run now: its input dependencies exist and no active failure suppression masks it. The selector's "more work" probe therefore reports attemptable work, not merely missing artifacts.

#### Scenario: Embedding is not flagged without an analysis row

- **WHEN** a song has no `song_embedding` row and no `song_analysis` row
- **THEN** the selector SHALL NOT flag the song as needing embedding
- **AND** the song SHALL NOT keep the account's enrichment queue alive on the embedding flag alone

#### Scenario: Embedding is flagged once its input exists

- **WHEN** a song gains a `song_analysis` row and still has no `song_embedding` row
- **THEN** the selector SHALL flag the song as needing embedding on the next pass

#### Scenario: Content activation honors suppression windows

- **WHEN** a song has an unresolved non-terminal `content_activation` failure with an active suppression window
- **THEN** the selector SHALL NOT flag the song as needing content activation until the window lapses
- **AND** this mirrors the suppression behavior of every other stage flag

#### Scenario: A fully blocked song is not selected

- **WHEN** every stage a song is missing is either input-blocked or actively suppressed
- **THEN** the selector SHALL NOT return the song at all
- **AND** the account's `hasMoreSongs` probe SHALL NOT report work owed on that song's account

### Requirement: Blocked-input failures are observable and convergent

Failure rows recorded for input-blocked analysis skips SHALL carry the underlying provider error detail, and repeated identical blocked failures SHALL escalate to a terminal state after a bounded number of attempts so that every song eventually reaches a final state.

#### Scenario: Blocked-skip failure rows preserve the underlying error

- **WHEN** an analysis skip is recorded because a lyrics or audio provider attempt failed
- **THEN** the failure row SHALL include the underlying error detail (error class, HTTP status when present, and the resource URL when present)
- **AND** it SHALL NOT reduce the cause to a generic provider-unavailable message

#### Scenario: Repeated identical blocked failures escalate to terminal

- **WHEN** a song accumulates unresolved blocked failures for the same stage and failure code reaching the escalation threshold
- **THEN** the next identical failure SHALL be recorded as terminal with confirmed-inputs-missing semantics
- **AND** the existing replacement-credit compensation SHALL apply exactly as for a directly confirmed inputs-missing failure

#### Scenario: Escalated songs leave the automatic queue but stay recoverable

- **WHEN** a song's blocked failure escalates to terminal
- **THEN** the song SHALL be excluded from automatic chunk selection like any terminally failed song
- **AND** the existing manual retry flow SHALL be able to clear the terminal state if the provider recovers
