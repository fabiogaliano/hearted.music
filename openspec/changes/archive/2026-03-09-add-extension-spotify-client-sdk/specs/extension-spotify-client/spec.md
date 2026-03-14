## ADDED Requirements

### Requirement: Extension-resident Spotify client module

The system SHALL provide a typed Spotify client module inside the extension that encapsulates Spotify internal API operations behind method-level contracts.

#### Scenario: Client exposes read operations
- **WHEN** extension code needs liked tracks, playlists, playlist contents, profile, or artist overview for image enrichment
- **THEN** it calls typed read methods on the extension Spotify client
- **AND** call sites do not build Pathfinder payloads inline

#### Scenario: Unsupported operation remains deterministic
- **WHEN** a caller requests operations not included in v1 command/client contracts
- **THEN** the extension client returns a typed unsupported-operation error
- **AND** supported v1 operations (including artist overview lookup) continue to execute normally

#### Scenario: Artist overview is supported in v1
- **WHEN** the app requests artist image metadata for a known artist
- **THEN** the extension client executes `queryArtistOverview` (or the documented internal equivalent)
- **AND** returns typed image metadata in the standard result envelope

#### Scenario: Client exposes write operations
- **WHEN** extension code needs to add/remove playlist items or create/update/delete playlists
- **THEN** it calls typed write methods on the extension Spotify client
- **AND** write callers do not construct raw Playlist v2 or Pathfinder mutation requests inline

---

### Requirement: Pathfinder execution and hash handling

The extension Spotify client SHALL execute Pathfinder reads and mutations through a shared wrapper with hash lookup and rate-limit retry behavior.

#### Scenario: Known operation executes with persisted query hash
- **WHEN** a Spotify client method invokes a Pathfinder operation
- **THEN** the request includes `operationName`, `variables`, and `extensions.persistedQuery.sha256Hash`
- **AND** the hash is resolved from runtime/storage/default hash registry tiers

#### Scenario: Pathfinder rate limit response
- **WHEN** Pathfinder responds with HTTP 429 and `Retry-After`
- **THEN** the client waits according to `Retry-After`
- **AND** retries up to the configured maximum before returning a typed error

#### Scenario: Unknown Pathfinder operation hash
- **WHEN** a Spotify client method references an operation with no hash in runtime, storage, or defaults
- **THEN** the client returns a deterministic unknown-operation error
- **AND** the service worker does not perform an un-hashed request

---

### Requirement: Playlist v2 delta operation support

The extension Spotify client SHALL support playlist-level operations through Playlist v2 endpoints with canonical delta payload construction.

#### Scenario: Create playlist
- **WHEN** the caller requests playlist creation
- **THEN** the client performs the create call and the rootlist add call as a two-step flow
- **AND** returns the created playlist URI and revision metadata

#### Scenario: Update playlist attributes
- **WHEN** the caller requests name and/or description changes
- **THEN** the client sends `UPDATE_LIST_ATTRIBUTES` to `/playlist/v2/playlist/{playlistId}/changes`
- **AND** includes only fields requested for update

#### Scenario: Delete playlist from rootlist
- **WHEN** the caller requests playlist deletion
- **THEN** the client sends a rootlist `REM` delta for the target playlist URI
- **AND** returns a success/failure result envelope

#### Scenario: Playlist v2 endpoint host resolution
- **WHEN** the client executes a Playlist v2 operation
- **THEN** it resolves the target `spclient` host through one centralized resolver in the playlist module
- **AND** applies a deterministic fallback host strategy when the primary host is unavailable

---

### Requirement: Service-worker command routing integration

The extension SHALL route externally_connectable Spotify commands to the extension Spotify client and enforce token preconditions.

#### Scenario: Valid command maps to client method
- **WHEN** the web app sends a supported Spotify command to the extension service worker
- **THEN** the service worker dispatches to the corresponding Spotify client method
- **AND** returns the method result using the standard command response envelope

#### Scenario: Missing or expired Spotify token
- **WHEN** a command requiring Spotify auth is received without a valid token
- **THEN** the service worker rejects the command with a typed auth error
- **AND** does not attempt external API requests

---

### Requirement: Standard command response envelope

The extension Spotify command layer SHALL return a normalized response envelope for success and failure paths.

#### Scenario: Successful command response
- **WHEN** a Spotify command succeeds
- **THEN** the extension returns an envelope with `ok: true` and typed `data`
- **AND** echoes the caller-provided `commandId` unchanged so callers can correlate response handling

#### Scenario: Failed command response
- **WHEN** a Spotify command fails due to auth, validation, rate limits, or upstream errors
- **THEN** the extension returns an envelope with `ok: false`, a stable `errorCode`, and a human-readable `message`
- **AND** includes whether the error is retryable and the original `commandId`

---

### Requirement: Internal API request and response object contracts

The extension Spotify client SHALL maintain documented request and raw response object shapes for each supported internal API operation.

#### Scenario: Supported operation has documented request/response shapes
- **WHEN** an operation is supported by the extension Spotify client
- **THEN** the operation includes captured request and raw response object documentation
- **AND** DTO mapping code references that documentation as the contract source

#### Scenario: Response parser update after upstream drift
- **WHEN** Spotify changes response shape for a supported operation
- **THEN** maintainers update the documented raw response contract and parser/types together
- **AND** avoid silent parser drift through ad-hoc field access changes

---

### Requirement: Conservative batching policy

The extension Spotify client SHALL use native multi-item operation payloads only where confirmed and otherwise execute writes sequentially with pacing.

#### Scenario: Operation has confirmed native batch payload
- **WHEN** an operation supports multi-item payloads (for example `playlistItemUris[]` in `addToPlaylist`)
- **THEN** the client sends one native request with the multi-item payload
- **AND** applies standard retry/rate-limit handling

#### Scenario: Operation has no confirmed batch semantics
- **WHEN** no reliable native batch behavior is captured for an operation
- **THEN** the app/extension executes commands sequentially with pacing
- **AND** avoids custom bulk wrappers that assume undocumented server behavior

---

### Requirement: On-demand live contract verification

The extension Spotify client SHALL provide an on-demand live contract test mode that validates supported response parsers against real Spotify internal API responses.

#### Scenario: Manual live contract run
- **WHEN** a developer explicitly runs the live contract test command
- **THEN** tests call supported internal endpoints with real captured auth context and validate parser/type assumptions
- **AND** failures identify operation-level schema drift

#### Scenario: Default automated test runs
- **WHEN** the normal unit/integration test suite runs in development or CI
- **THEN** live contract tests are skipped by default
- **AND** standard tests rely on fixtures/mocks for deterministic execution
