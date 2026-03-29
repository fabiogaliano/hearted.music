# Library Processing Specification

> Durable control plane that owns freshness tracking, reconciliation, and follow-on job scheduling for enrichment and match snapshot refresh workflows.

---

## Purpose

Define the library-processing control plane that persists per-account workflow freshness state, accepts typed changes from source boundaries (sync, onboarding, worker outcomes), reconciles requested versus settled freshness, and ensures the needed background jobs without scattering follow-on policy across callers.

---

## Requirements

### Requirement: Library-processing state is the durable freshness source of truth

The system SHALL persist one `library_processing_state` row per account and use it as the durable source of truth for `enrichment` and `matchSnapshotRefresh` freshness.

#### Scenario: State row is created lazily on first library-processing use
- **WHEN** an account receives its first library-processing change
- **THEN** the system SHALL create a `library_processing_state` row for that account
- **AND** the row SHALL contain flattened typed columns for each workflow's `requestedAt`, `settledAt`, and `activeJobId`

#### Scenario: Workflow staleness is determined from request markers
- **WHEN** a workflow has `requestedAt` set and `settledAt` is null or older than that marker
- **THEN** the workflow SHALL be treated as stale
- **AND** reconciliation SHALL consider that workflow still owed work

#### Scenario: Successful settlement uses the satisfied request marker
- **WHEN** an `enrichment` or `match_snapshot_refresh` job successfully satisfies a workflow request
- **THEN** the system SHALL set `settledAt` to the request marker that job was created to satisfy
- **AND** it SHALL NOT use wall-clock completion time as the settlement marker

#### Scenario: Active job references live in library-processing state
- **WHEN** reconciliation associates a workflow with an active job
- **THEN** the system SHALL persist that job ID in the workflow's `activeJobId`
- **AND** it SHALL clear that reference when the job settles or fails

---

### Requirement: Library-processing changes are source-shaped and applied synchronously

The system SHALL accept a typed `LibraryProcessingChange` union and apply it through `applyLibraryProcessingChange(...)`, with request markers stamped inside the apply service rather than by source helpers.

#### Scenario: Onboarding target confirmation emits a semantic change
- **WHEN** onboarding confirms an initial target selection containing one or more targets
- **THEN** the source boundary SHALL emit `onboarding_target_selection_confirmed`
- **AND** an initial empty selection or skip SHALL emit no library-processing change

#### Scenario: Sync emits one aggregated library-synced change per request
- **WHEN** `/api/extension/sync` finishes its persistence phases for a request
- **THEN** it SHALL emit exactly one `library_synced` change for that request
- **AND** the change SHALL carry required `likedSongs` and `targetPlaylists` booleans without any request marker or timestamp

#### Scenario: Enrichment worker outcomes are explicit
- **WHEN** an `enrichment` job finishes a pass
- **THEN** the worker boundary SHALL emit either `enrichment_completed` with `requestSatisfied` and `newCandidatesAvailable` or `enrichment_stopped` with `reason = local_limit | error`
- **AND** it SHALL NOT collapse those outcomes into an ambiguous generic completion signal

#### Scenario: Match snapshot worker outcomes are explicit
- **WHEN** a `match_snapshot_refresh` job settles
- **THEN** the worker boundary SHALL emit either `match_snapshot_published` or `match_snapshot_failed`
- **AND** those outcome changes SHALL be applied through `applyLibraryProcessingChange(...)`

---

### Requirement: Reconciliation decides follow-on work from durable freshness

The system SHALL reconcile requested versus settled freshness and ensure the needed `enrichment` and `match_snapshot_refresh` jobs instead of letting source handlers or workers encode follow-on policy inline.

#### Scenario: Liked-song additions with current targets request both workflows
- **WHEN** `library_synced` reports `likedSongs.added = true`
- **AND** the account currently has one or more target playlists
- **THEN** reconciliation SHALL advance `enrichment.requestedAt`
- **AND** it SHALL also advance `matchSnapshotRefresh.requestedAt`

#### Scenario: Liked-song additions without targets request enrichment only
- **WHEN** `library_synced` reports `likedSongs.added = true`
- **AND** the account currently has zero target playlists
- **THEN** reconciliation SHALL advance `enrichment.requestedAt`
- **AND** it SHALL leave `matchSnapshotRefresh.requestedAt` unchanged for that addition alone

#### Scenario: Liked-song removals and target-side changes request refresh only
- **WHEN** `library_synced` reports liked-song removals or processing-relevant target-playlist changes
- **THEN** reconciliation SHALL advance `matchSnapshotRefresh.requestedAt`
- **AND** it SHALL avoid requesting `enrichment` unless candidate-side work is also owed

#### Scenario: New enrichment candidates can re-invalidate refresh before enrichment settles
- **WHEN** `enrichment_completed` reports `newCandidatesAvailable = true`
- **AND** the account currently has one or more target playlists
- **THEN** reconciliation SHALL advance `matchSnapshotRefresh.requestedAt`
- **AND** it SHALL do so even if `enrichment.requestSatisfied = false` and more enrichment remains owed

#### Scenario: Failures remain stale without immediate auto-reensure
- **WHEN** `enrichment_stopped` with `reason = error` or `local_limit`, or `match_snapshot_failed`, is applied
- **THEN** reconciliation SHALL clear the corresponding `activeJobId` without advancing `settledAt`
- **AND** it SHALL leave the workflow stale without immediately auto-reensuring another job in the same apply cycle

---

### Requirement: Ensured jobs carry durable scheduling metadata

Jobs that satisfy library-processing freshness SHALL carry the request marker they were created to satisfy and the queue-priority metadata needed for DB claim ordering.

#### Scenario: Ensured jobs store the request marker they satisfy
- **WHEN** reconciliation ensures an `enrichment` or `match_snapshot_refresh` job for a stale workflow
- **THEN** the created or reused job SHALL carry the exact request marker it is intended to satisfy
- **AND** later settlement SHALL use that stored marker to advance `settledAt`

#### Scenario: Queue priority is resolved outside the pure reconciler
- **WHEN** effect execution decides what priority to assign a worker-claimed job
- **THEN** it SHALL map current account entitlements into neutral `low`, `standard`, or `priority` bands outside the pure reconciler
- **AND** the scheduler SHALL not hardcode pricing-plan copy inside `LibraryProcessingState`

#### Scenario: Queue priority is persisted only on worker-claimed jobs
- **WHEN** a queue-claimed `enrichment` or `match_snapshot_refresh` job is created or ensured
- **THEN** the system SHALL persist a numeric `queue_priority` value on the `job` row
- **AND** sync-phase jobs SHALL NOT be required to use queue priority

#### Scenario: Match snapshot execution hints are derived at ensure time
- **WHEN** effect execution ensures a `match_snapshot_refresh` job
- **THEN** it SHALL derive execution hints such as `needsTargetSongEnrichment` from current database state at ensure time
- **AND** it SHALL NOT persist those hints in `library_processing_state`

---

### Requirement: First visible match remains a derived read-model signal

The system SHALL derive `firstMatchReady` from the latest published snapshot instead of storing milestone state in `library_processing_state`.

#### Scenario: Non-empty latest snapshot yields first-match readiness
- **WHEN** the latest published snapshot for an account contains one or more matches
- **THEN** the read model SHALL report `firstMatchReady = true`
- **AND** that signal SHALL remain derived rather than persisted in control-plane state

#### Scenario: Missing or empty latest snapshot is not first-match ready
- **WHEN** an account has no published snapshot or the latest published snapshot is empty
- **THEN** the read model SHALL report `firstMatchReady = false`
- **AND** the control plane SHALL NOT add a dedicated milestone field for that condition

#### Scenario: Existing polling and invalidation refresh the derived signal
- **WHEN** background library-processing work settles and existing job polling detects the new job state
- **THEN** existing query invalidation or refetch flows SHALL update `firstMatchReady`
- **AND** the system SHALL NOT require a new worker-owned SSE transport just for that signal
