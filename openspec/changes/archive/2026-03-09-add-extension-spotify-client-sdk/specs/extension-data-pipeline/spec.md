## MODIFIED Requirements

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
- **AND** the extension executes the operation with the user’s intercepted Spotify token

#### Scenario: Web app requests artist image lookup command
- **WHEN** app orchestration needs artist-image metadata for tracks
- **AND** the extension is detected as installed
- **THEN** the web app sends a typed read command to the extension for artist overview/image retrieval
- **AND** the extension executes the internal API call with the user’s intercepted Spotify token

#### Scenario: Command execution happens from browser runtime
- **WHEN** a Spotify command needs to be sent to the extension
- **THEN** the command is initiated from browser/client code
- **AND** server-only runtimes do not attempt to call `chrome.runtime.sendMessage`

#### Scenario: Extension not available for command trigger
- **WHEN** the web app attempts to trigger sync or a Spotify write command
- **AND** the extension is not detected
- **THEN** the system shows an extension installation or reconnect prompt

## ADDED Requirements

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

The system SHALL persist extension write outcomes to backend state through a server acknowledgement step after command execution.

#### Scenario: Successful write command updates DB state
- **WHEN** a browser-triggered extension write command succeeds
- **THEN** the app calls a server endpoint/function to persist the successful outcome in DB state
- **AND** UI/server state reflects the write without waiting for the next full sync

#### Scenario: Failed write command records failure state
- **WHEN** a browser-triggered extension write command fails
- **THEN** the app records failure metadata through a server endpoint/function
- **AND** UI/server state can show deterministic failure and retry guidance
