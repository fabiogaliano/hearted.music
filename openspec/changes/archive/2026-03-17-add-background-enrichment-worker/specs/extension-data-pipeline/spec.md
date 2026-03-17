## MODIFIED Requirements

### Requirement: Extension as Primary Data Source

The system SHALL use the Chrome extension as the primary mechanism for ingesting Spotify data and triggering only the durable background enrichment work that belongs to the sync boundary.

#### Scenario: Extension syncs liked songs to backend
- **WHEN** the extension triggers a sync
- **THEN** it fetches liked songs via Spotify's Pathfinder API
- **AND** POSTs the data to `/api/extension/sync` with `Authorization: Bearer <token>` header
- **AND** the backend validates the bearer token and writes data to the database

#### Scenario: Extension syncs playlists to backend
- **WHEN** the extension triggers a sync
- **THEN** it fetches user-owned playlists via Pathfinder API
- **AND** includes playlist data in the POST to `/api/extension/sync`
- **AND** the backend upserts playlist records for the authenticated user

#### Scenario: Sync queues background enrichment follow-on work
- **WHEN** `/api/extension/sync` completes its persistence phases successfully
- **THEN** the system SHALL create or reuse an active account-scoped `enrichment` background job
- **AND** that follow-on work SHALL run outside the sync request lifecycle
- **AND** it MAY include all enrichment stages from `audio_features` through `matching`
- **AND** the sync request SHALL NOT wait for the background job to finish

#### Scenario: No Spotify OAuth tokens required
- **WHEN** data ingestion occurs
- **THEN** the system SHALL NOT require Spotify OAuth access tokens stored server-side
- **AND** all Spotify data flows exclusively through the extension's intercepted session tokens

---

### Requirement: Extension Sync Progress via SSE

The system SHALL surface sync-phase progress through SSE and background enrichment progress through persisted job state.

#### Scenario: Extension sync creates job records
- **WHEN** the extension POSTs data to `/api/extension/sync`
- **THEN** the backend creates job records for each sync phase (liked songs, playlists)
- **AND** emits SSE progress events as sync data is processed

#### Scenario: Web app subscribes to extension sync progress
- **WHEN** the web app triggers a sync via the extension during onboarding
- **THEN** the web app subscribes to `/api/jobs/$id/progress` for sync phase job IDs
- **AND** displays sync progress using the existing `useJobProgress` hook or an equivalent SSE consumer

#### Scenario: Successful sync response exposes the current enrichment job
- **WHEN** the extension sync endpoint returns successfully
- **THEN** the response SHALL include `phaseJobIds`
- **AND** it SHALL include `enrichmentJobId` for the current active background enrichment job at response time

#### Scenario: Web app polls background enrichment progress
- **WHEN** the web app needs follow-on enrichment progress after sync returns
- **THEN** it SHALL read persisted `status`, `progress`, and `error` state from the background enrichment job
- **AND** it MAY resolve that job either from the returned `enrichmentJobId` or from the latest persisted account-level enrichment job pointer
- **AND** it SHALL NOT depend on SSE emitted from the worker runtime

#### Scenario: Extension sync completes
- **WHEN** all sync phases finish processing
- **THEN** the backend emits terminal status events (completed or failed)
- **AND** the SSE stream closes
