# extension-data-pipeline Specification

## Purpose
Chrome extension-based data pipeline for ingesting Spotify data (liked songs, playlists) into the backend without requiring server-side Spotify OAuth tokens.
## Requirements
### Requirement: Extension as Primary Data Source

The system SHALL use the Chrome extension as the primary mechanism for ingesting Spotify data and emitting one aggregated `library_synced` change that drives durable background library-processing after sync-time change classification.

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

#### Scenario: Sync emits one aggregated library-processing change
- **WHEN** `/api/extension/sync` completes its persistence phases successfully
- **THEN** the backend SHALL call `applyLibraryProcessingChange(...)` exactly once with a backend-internal `library_synced` change for that request
- **AND** that change SHALL carry required liked-song and target-playlist booleans without timestamps or request markers

#### Scenario: All-false sync results still emit a semantic sync change
- **WHEN** a sync request completes with no processing-relevant changes
- **THEN** the backend SHALL still emit one aggregated `library_synced` change for that request
- **AND** all change booleans SHALL be `false`

#### Scenario: Liked-song additions with current targets request both workflows
- **WHEN** sync detects newly added liked songs and the account currently has one or more target playlists
- **THEN** the aggregated `library_synced` change SHALL allow library-processing to invalidate both `enrichment` and `matchSnapshotRefresh`
- **AND** follow-on work SHALL run outside the sync request lifecycle

#### Scenario: Liked-song additions without current targets request enrichment only
- **WHEN** sync detects newly added liked songs and the account currently has zero target playlists
- **THEN** the aggregated `library_synced` change SHALL allow library-processing to invalidate `enrichment`
- **AND** it SHALL not force immediate refresh invalidation for that addition alone

#### Scenario: Non-target playlist-only changes do not request follow-on work
- **WHEN** sync detects changes only in playlists that are not currently targets
- **THEN** the emitted `library_synced` change SHALL leave the processing-relevant booleans false for that reason alone
- **AND** the sync request SHALL not schedule library-processing follow-on work from those non-target changes alone

#### Scenario: No Spotify OAuth tokens required
- **WHEN** data ingestion occurs
- **THEN** the system SHALL NOT require Spotify OAuth access tokens stored server-side
- **AND** all Spotify data flows exclusively through the extension's intercepted session tokens

---

### Requirement: Sync captures target-playlist change facts before refresh planning

The system SHALL preserve the target-playlist facts needed to emit correct `library_synced` change booleans before destructive playlist writes remove that information from the database.

#### Scenario: Target playlist removal is detected before delete
- **WHEN** sync determines that a playlist has been removed from Spotify
- **THEN** it SHALL record whether that playlist was part of the current target set before deleting the playlist row
- **AND** it SHALL use that fact when computing `targetPlaylists.removed`

#### Scenario: Target playlist track changes are classified from current target membership
- **WHEN** playlist-track sync changes membership for one or more playlists
- **THEN** sync classification SHALL determine whether the changed playlist IDs intersect the current target set
- **AND** it SHALL use that fact when computing `targetPlaylists.trackMembershipChanged`

#### Scenario: Metadata-only target changes use profile-text booleans
- **WHEN** sync detects name or description changes on current target playlists without processing-relevant track membership changes
- **THEN** it SHALL set `targetPlaylists.profileTextChanged = true`
- **AND** it SHALL avoid broadening that fact into a less specific metadata bucket

#### Scenario: Processing-relevant target removals share one public boolean
- **WHEN** sync detects that some or all current target playlists were removed or toggled off
- **THEN** it SHALL set `targetPlaylists.removed = true`
- **AND** later reconciliation or execution-time DB reads SHALL determine whether refresh publishes remaining-target or empty-target state

#### Scenario: Incomplete track sync does not invent false target facts
- **WHEN** playlist-track sync cannot confidently classify whether target playlists changed
- **THEN** the emitted `library_synced` change SHALL avoid inventing more specific target-side booleans than the source data supports
- **AND** later execution-time DB reads SHALL preserve correctness for any follow-on refresh work

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

The system SHALL allow the web app to request extension-executed Spotify operations via message commands.

#### Scenario: Web app triggers sync during onboarding
- **WHEN** the user reaches the syncing step in onboarding
- **AND** the extension is detected as installed
- **THEN** the web app sends a message to the extension to start syncing

#### Scenario: Web app triggers sync from dashboard
- **WHEN** the user clicks the Sync button on the dashboard
- **AND** the extension is detected as installed
- **THEN** the web app sends a message to the extension to start syncing

#### Scenario: Web app requests Spotify write command
- **WHEN** app orchestration decides to perform a Spotify write operation (for example add/remove track or create/update/delete playlist)
- **AND** the extension is detected as installed
- **THEN** the web app sends a typed command message to the extension
- **AND** the extension executes the operation with the user's intercepted Spotify token

#### Scenario: Web app requests artist image lookup command
- **WHEN** app orchestration needs artist-image metadata for tracks
- **AND** the extension is detected as installed
- **THEN** the web app sends a typed read command to the extension for artist overview/image retrieval
- **AND** the extension executes the internal API call with the user's intercepted Spotify token

#### Scenario: Command execution happens from browser runtime
- **WHEN** a Spotify command needs to be sent to the extension
- **THEN** the command is initiated from browser/client code
- **AND** server-only runtimes do not attempt to call `chrome.runtime.sendMessage`

#### Scenario: Extension not available for command trigger
- **WHEN** the web app attempts to trigger sync or a Spotify write command
- **AND** the extension is not detected
- **THEN** the system shows an extension installation or reconnect prompt

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

### Requirement: Typed app-extension command protocol

The system SHALL define a typed command protocol for app↔extension Spotify operations.

#### Scenario: Command has operation and typed payload
- **WHEN** the web app sends a Spotify command to the extension
- **THEN** the message includes a command name and a validated payload shape for that command
- **AND** includes a caller-generated `commandId` from browser/app proxy code
- **AND** unsupported commands are rejected with a typed protocol error

#### Scenario: Command response is normalized
- **WHEN** the extension returns a command result
- **THEN** the response uses a normalized envelope indicating success or failure
- **AND** responses echo the original `commandId` and failure responses include a stable error code and retryability metadata

---

### Requirement: Extension executes user-scoped Spotify writes

The system SHALL execute user-scoped Spotify write operations from the extension context rather than from backend Spotify SDK credentials.

#### Scenario: Add/remove playlist items
- **WHEN** an add or remove operation is requested
- **THEN** the extension performs Pathfinder mutation calls using the intercepted Spotify bearer token
- **AND** the backend does not perform equivalent user-scoped write requests directly

#### Scenario: Playlist create/update/delete operations
- **WHEN** playlist-level operations are requested
- **THEN** the extension performs Playlist v2 delta requests
- **AND** operation outcomes are returned to app orchestration through the command response envelope

---

### Requirement: Artist-image enrichment uses extension command path

The system SHALL retrieve artist-image metadata through extension-executed Spotify internal API commands instead of server app-auth Spotify API endpoints.

#### Scenario: Artist image enrichment request
- **WHEN** the app needs artist images for track display/enrichment
- **THEN** the browser triggers an extension command for artist overview/image retrieval
- **AND** the extension returns normalized command results to the app

#### Scenario: Server app-auth path is not primary
- **WHEN** artist-image enrichment is executed in normal operation
- **THEN** the system does not depend on server app-auth Spotify API calls as the primary source
- **AND** artist-image flow remains within the browser→extension execution boundary

---

### Requirement: Write outcome persistence in backend state

The system SHALL persist extension write outcomes to backend state through a server acknowledgement step after command execution. Playlist-level writes SHALL use that acknowledgement path to update app DB state immediately instead of waiting for the next full sync to surface the result.

#### Scenario: Successful playlist create command updates DB state immediately
- **WHEN** a browser-triggered `createPlaylist` command succeeds
- **THEN** the app calls a server endpoint/function to create or upsert the corresponding `playlist` row in DB state immediately
- **AND** UI/server state can reflect the new playlist without waiting for the next full sync
- **AND** later extension sync acts as reconciliation rather than the primary mechanism for showing the playlist

#### Scenario: Successful playlist metadata command updates DB state immediately
- **WHEN** a browser-triggered `updatePlaylist` command succeeds
- **THEN** the app calls a server endpoint/function to persist the confirmed playlist `name` and/or `description` in DB state immediately
- **AND** UI/server state can reflect the metadata change without waiting for the next full sync

#### Scenario: Successful playlist delete command updates DB state immediately
- **WHEN** a browser-triggered `deletePlaylist` command succeeds
- **THEN** the app calls a server endpoint/function to remove the corresponding `playlist` row from DB state immediately
- **AND** UI/server state can stop showing that playlist without waiting for the next full sync

#### Scenario: Failed playlist-level write records failure state without mutating DB
- **WHEN** a browser-triggered playlist-level extension write command fails
- **THEN** the app records failure metadata through a server endpoint/function or equivalent client/server path
- **AND** the corresponding playlist create, metadata update, or delete mutation is not applied to app DB state
- **AND** UI/server state can show deterministic failure and retry guidance

