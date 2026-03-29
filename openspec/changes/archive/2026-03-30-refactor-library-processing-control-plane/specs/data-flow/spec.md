## MODIFIED Requirements

### Requirement: SSE for Real-Time Progress

The system SHALL use SSE for request-local job progress and database polling for cross-process background library-processing progress.

#### Scenario: Progress display for background library-processing jobs
- **WHEN** a queued `enrichment` or `match_snapshot_refresh` job is running inside the VPS worker process
- **THEN** the client SHALL read progress by polling persisted `job` state
- **AND** it SHALL use `status`, `progress`, and `error` fields from the database as the source of truth

#### Scenario: Terminal background library-processing job handling
- **WHEN** a polled `enrichment` or `match_snapshot_refresh` job reaches `completed` or `failed`
- **THEN** the polling consumer SHALL stop polling that job identifier
- **AND** it MAY re-read persisted library-processing-backed active work to discover a later ensured job
- **AND** it SHALL not depend on `user_preferences` job pointers or worker-owned chunk chaining

## ADDED Requirements

### Requirement: Library-processing read models surface active work and first-match readiness

The system SHALL surface active library-processing work and derived first-match readiness through persisted read models and server functions backed by `library_processing_state` and `job`, not through `user_preferences` orchestration pointers or worker-owned SSE.

#### Scenario: Active background work is resolved from persisted library-processing state
- **WHEN** onboarding or dashboard loaders need to show current background processing state
- **THEN** the system SHALL resolve active `enrichment` and `match_snapshot_refresh` jobs from persisted library-processing state and job rows
- **AND** it SHALL not depend on `user_preferences.enrichment_job_id` or `user_preferences.target_playlist_match_refresh_job_id`

#### Scenario: First-match readiness is derived from the latest published snapshot
- **WHEN** a loader or server function needs to answer whether the account has a real visible match yet
- **THEN** it SHALL derive `firstMatchReady` from the latest published snapshot for that account
- **AND** it SHALL not persist a separate milestone flag in `library_processing_state`

#### Scenario: Existing polling and invalidation refresh cross-process progress
- **WHEN** a queued background library-processing job settles in the worker process
- **THEN** existing job polling and query invalidation flows SHALL refresh the corresponding read models
- **AND** the UI SHALL not require worker-runtime SSE or Supabase Realtime to observe that cross-process state change

## REMOVED Requirements

### Requirement: Trigger-scoped enrichment follow-on work
**Reason**: Follow-on scheduling ownership moves from direct sync/save trigger helpers into the `library-processing` control plane and `applyLibraryProcessingChange(...)`.
**Migration**: Emit typed `LibraryProcessingChange` values from sync, onboarding, and worker outcome boundaries, then let reconciliation ensure the needed jobs.

### Requirement: Persisted active enrichment job pointer
**Reason**: Orchestration pointers move out of `user_preferences` and into `library_processing_state` workflow refs plus library-processing-backed read models.
**Migration**: Resolve active `enrichment` and `match_snapshot_refresh` jobs from persisted library-processing state and current job rows instead of reading account-level pointer fields from `user_preferences`.
