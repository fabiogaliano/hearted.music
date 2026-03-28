## ADDED Requirements

### Requirement: Playlist-level Spotify writes use browser command execution plus server acknowledgement
The system SHALL execute playlist-level Spotify writes through the browser extension and SHALL persist confirmed outcomes through authenticated server acknowledgement functions instead of waiting for a later full sync to surface those changes in app state.

#### Scenario: Confirmed playlist-level command triggers acknowledgement
- **WHEN** a browser-triggered playlist-level extension command succeeds for create, metadata update, or delete
- **THEN** the app calls an authenticated server function with the validated command outcome and the request fields needed to persist app state
- **AND** the server acknowledgement step persists app DB state without attempting the Spotify write itself

#### Scenario: Failed playlist-level command does not mutate app DB state
- **WHEN** a browser-triggered playlist-level extension command returns a failed command envelope
- **THEN** the app SHALL NOT apply the corresponding playlist create, metadata update, or delete mutation to app DB state
- **AND** the app MAY record deterministic failure metadata for UI retry guidance

### Requirement: Successful playlist creation acknowledgement inserts an immediate playlist row
The system SHALL make a newly created playlist visible in app DB state immediately after a confirmed extension-side create result.

#### Scenario: Create acknowledgement derives spotify_id from playlist URI
- **WHEN** `createPlaylist(...)` succeeds and the extension returns a playlist URI
- **THEN** the server acknowledgement flow derives the playlist `spotify_id` from that URI
- **AND** it creates or upserts a `playlist` row for the authenticated account without waiting for the next sync

#### Scenario: Create acknowledgement persists only metadata known at confirmation time
- **WHEN** the server acknowledges a successful playlist creation
- **THEN** it persists the playlist `name` from the create request
- **AND** it SHALL use safe provisional values for fields not known from the confirmed create response
- **AND** later extension sync MAY enrich non-essential metadata such as image URL or other playlist facts without duplicating the row

### Requirement: Successful playlist metadata acknowledgement updates the existing row immediately
The system SHALL persist confirmed playlist metadata writes for `name` and `description` into the existing app playlist row immediately after extension success.

#### Scenario: Metadata acknowledgement updates supported fields only
- **WHEN** `updatePlaylist(...)` succeeds for a playlist belonging to the authenticated account
- **THEN** the server acknowledgement flow updates the existing `playlist` row's supported metadata fields immediately
- **AND** it SHALL preserve unrelated playlist fields such as target membership, song count, and image URL unless this acknowledgement flow explicitly owns them

#### Scenario: Metadata acknowledgement does not depend on later sync for visibility
- **WHEN** a confirmed playlist metadata update has been acknowledged successfully
- **THEN** app reads and query-backed UI state SHALL be able to reflect the new metadata before the next full extension sync runs

### Requirement: Successful playlist deletion acknowledgement removes the row immediately
The system SHALL remove a playlist from app DB state immediately after a confirmed extension-side delete result.

#### Scenario: Delete acknowledgement removes playlist row and dependent membership
- **WHEN** `deletePlaylist(...)` succeeds for a playlist belonging to the authenticated account
- **THEN** the server acknowledgement flow removes the corresponding `playlist` row immediately
- **AND** dependent `playlist_song` rows SHALL be removed by the existing database relationship behavior

#### Scenario: Delete acknowledgement is idempotent for already-absent rows
- **WHEN** a confirmed delete acknowledgement arrives for a playlist row that is already absent from app DB state
- **THEN** the server acknowledgement flow treats the delete as a no-op success for app-state persistence
- **AND** it does not require a later sync to reconcile that absence

### Requirement: Playlist acknowledgement remains account-scoped and playlist-level only
The system SHALL scope this acknowledgement capability to playlist rows owned by the authenticated account and SHALL not expand it to playlist-item writes in this change.

#### Scenario: Account scope prevents cross-account mutation
- **WHEN** the app acknowledges a playlist-level write outcome
- **THEN** it SHALL resolve and mutate playlist rows only within the authenticated account boundary
- **AND** it SHALL NOT create, update, or delete another account's playlist rows

#### Scenario: Track-item writes remain out of scope for this capability
- **WHEN** app orchestration performs `addToPlaylist(...)` or `removeFromPlaylist(...)`
- **THEN** this playlist-write-acknowledgement capability does not require those commands to update `playlist_song` membership immediately
- **AND** those write flows remain separate from this change's playlist-row acknowledgement scope
