## MODIFIED Requirements

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
- **THEN** the worker boundary SHALL emit either `enrichment_completed` with `requestSatisfied` and `newCandidatesAvailable` or `enrichment_stopped` with `reason = local_limit | error | blocked`
- **AND** it SHALL NOT collapse those outcomes into an ambiguous generic completion signal

#### Scenario: Match snapshot worker outcomes are explicit

- **WHEN** a `match_snapshot_refresh` job settles
- **THEN** the worker boundary SHALL emit either `match_snapshot_published` or `match_snapshot_failed`
- **AND** those outcome changes SHALL be applied through `applyLibraryProcessingChange(...)`

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

- **WHEN** `enrichment_stopped` with `reason = error`, `local_limit`, or `blocked`, or `match_snapshot_failed`, is applied
- **THEN** reconciliation SHALL clear the corresponding `activeJobId` without advancing `settledAt`
- **AND** it SHALL leave the workflow stale without immediately auto-reensuring another job in the same apply cycle
