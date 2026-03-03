## ADDED Requirements

### Requirement: Extension as Primary Data Source

The system SHALL use the Chrome extension as the primary mechanism for ingesting Spotify data (liked songs, playlists, playlist tracks).

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

#### Scenario: No Spotify OAuth tokens required
- **WHEN** data ingestion occurs
- **THEN** the system SHALL NOT require Spotify OAuth access tokens stored server-side
- **AND** all Spotify data flows exclusively through the extension's intercepted session tokens

---

### Requirement: Extension Authentication via Bearer Token

The system SHALL authenticate extension requests using a bearer token obtained through `externally_connectable` handoff.

#### Scenario: Extension receives API token from web app
- **WHEN** the user connects the extension during onboarding or from settings
- **THEN** the web app sends an API token to the extension via `chrome.runtime.sendMessage`
- **AND** the extension stores the token in `chrome.storage.local`

#### Scenario: Extension sends authenticated request
- **WHEN** the extension calls `/api/extension/sync` or `/api/extension/status`
- **THEN** it includes the API token as `Authorization: Bearer <token>` header
- **AND** the backend validates the token and resolves the associated account

#### Scenario: Extension request without valid token
- **WHEN** the extension sends a request without a valid bearer token
- **THEN** the backend returns HTTP 401
- **AND** the extension reports the user needs to reconnect from the web app

#### Scenario: Token revocation
- **WHEN** the user disconnects the extension or the token is revoked
- **THEN** the extension removes the token from `chrome.storage.local`
- **AND** subsequent requests fail with HTTP 401

---

### Requirement: Extension Installation Detection

The system SHALL detect whether the Chrome extension is installed from the web app.

#### Scenario: Extension is installed
- **WHEN** the web app checks for extension presence
- **THEN** the system detects the extension is available
- **AND** enables sync-related UI elements

#### Scenario: Extension is not installed
- **WHEN** the web app checks for extension presence
- **THEN** the system determines the extension is not installed
- **AND** shows an installation prompt with a link to the Chrome Web Store

---

### Requirement: Spotify ID Linking on First Sync

The system SHALL link the user's Spotify identity to their app account on the first extension sync.

#### Scenario: First sync with user profile
- **WHEN** the extension performs its first sync for a user
- **THEN** it includes the Spotify user profile (spotifyId, displayName, username) in the sync payload
- **AND** the backend stores `spotify_id` on the user's `account` record

#### Scenario: Subsequent syncs
- **WHEN** the extension performs a sync for a user with an existing `spotify_id`
- **THEN** the backend verifies the `spotify_id` matches the existing account
- **AND** proceeds with the sync without updating identity fields

#### Scenario: Spotify ID conflict
- **WHEN** a sync payload contains a `spotify_id` already linked to a different account
- **THEN** the backend rejects the sync with an error
- **AND** returns a message indicating the Spotify account is linked elsewhere

---

### Requirement: Sync Trigger from Web App

The system SHALL allow the web app to request a sync via the extension.

#### Scenario: Web app triggers sync during onboarding
- **WHEN** the user reaches the syncing step in onboarding
- **AND** the extension is detected as installed
- **THEN** the web app sends a message to the extension to start syncing

#### Scenario: Web app triggers sync from dashboard
- **WHEN** the user clicks the Sync button on the dashboard
- **AND** the extension is detected as installed
- **THEN** the web app sends a message to the extension to start syncing

#### Scenario: Extension not available for sync trigger
- **WHEN** the web app attempts to trigger a sync
- **AND** the extension is not detected
- **THEN** the system shows an extension installation prompt

---

### Requirement: Extension Sync Progress via SSE

The system SHALL produce SSE job progress events during extension-triggered syncs so the web app can display real-time progress.

#### Scenario: Extension sync creates job records
- **WHEN** the extension POSTs data to `/api/extension/sync`
- **THEN** the backend creates job records for each sync phase (liked songs, playlists)
- **AND** emits SSE progress events as data is processed

#### Scenario: Web app subscribes to extension sync progress
- **WHEN** the web app triggers a sync via the extension during onboarding
- **THEN** the web app subscribes to `/api/jobs/$id/progress` for real-time updates
- **AND** displays progress using the existing `useJobProgress` hook

#### Scenario: Extension sync completes
- **WHEN** all sync phases finish processing
- **THEN** the backend emits terminal status events (completed or failed)
- **AND** the SSE stream closes
