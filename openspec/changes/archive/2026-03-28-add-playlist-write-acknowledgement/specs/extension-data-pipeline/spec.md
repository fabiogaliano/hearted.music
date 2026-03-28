## MODIFIED Requirements

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
