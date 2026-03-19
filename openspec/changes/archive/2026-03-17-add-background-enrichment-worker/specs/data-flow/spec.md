## ADDED Requirements

### Requirement: Persisted active enrichment job pointer

The system SHALL persist the current active background enrichment job per account so the UI can recover progress across chained chunks.

#### Scenario: Trigger persists the active enrichment job pointer
- **WHEN** sync or onboarding creates or reuses an active `enrichment` background job for an account
- **THEN** the system SHALL persist that job identifier in account-scoped stored state
- **AND** later UI loads SHALL be able to recover the current background job identifier without relying on in-memory state

#### Scenario: Worker advances the pointer during chunk chaining
- **WHEN** the worker enqueues a successor chunk for an account
- **THEN** the persisted active enrichment job pointer SHALL be updated to the successor chunk job identifier
- **AND** subsequent progress lookups SHALL resolve to the newer chunk

#### Scenario: Pointer is cleared when the chain finishes
- **WHEN** an account has no remaining pending or running `enrichment` jobs
- **THEN** the persisted active enrichment job pointer SHALL be cleared
- **AND** future loads SHALL not report stale in-progress background work

## MODIFIED Requirements

### Requirement: SSE for Real-Time Progress

The system SHALL use SSE for request-local job progress and database polling for cross-process background enrichment progress.

#### Scenario: Progress subscription for sync jobs
- **WHEN** a sync-phase job starts inside the web application request runtime
- **THEN** the client connects to SSE endpoint `/api/jobs/$id/progress`
- **AND** the server emits in-memory progress events for that job while the request-owned work is active

#### Scenario: Progress display for background enrichment jobs
- **WHEN** a queued `enrichment` job is running inside the VPS worker process
- **THEN** the client SHALL read progress by polling persisted `job` state
- **AND** it SHALL use `status`, `progress`, and `error` fields from the database as the source of truth

#### Scenario: Terminal background job handling
- **WHEN** a polled background enrichment job reaches `completed` or `failed`
- **THEN** the polling consumer SHALL stop polling that job identifier
- **AND** it MAY resolve the latest persisted active enrichment job pointer to continue with a chained successor chunk

---

### Requirement: Trigger-scoped enrichment follow-on work

The system SHALL route enrichment follow-on work through an account-scoped background enrichment chain while keeping request-trigger boundaries explicit.

#### Scenario: Sync follow-on scope
- **WHEN** `/api/extension/sync` finishes its sync phases successfully
- **THEN** it SHALL create or reuse the account's background `enrichment` chain
- **AND** it SHALL NOT execute enrichment stages inline before returning the sync response

#### Scenario: Destination-save follow-on scope
- **WHEN** destination playlists are saved successfully during onboarding and follow-on enrichment is needed
- **THEN** the save flow SHALL create or reuse the same account-scoped background `enrichment` chain
- **AND** it SHALL NOT start a second duplicate active chain for the same account

#### Scenario: Trigger response isolation
- **WHEN** a sync request or destination-save request succeeds
- **THEN** the initiating response SHALL be allowed to complete before background enrichment finishes
- **AND** background follow-on failures SHALL be isolated from that already-successful response

#### Scenario: Legacy full-pipeline entry point is no longer the primary trigger path
- **WHEN** internal callers still use a legacy full-pipeline wrapper for scripts, tests, or compatibility
- **THEN** that wrapper MAY remain available internally
- **AND** the primary product-triggered path SHALL still be the background enrichment queue
