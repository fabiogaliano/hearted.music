## ADDED Requirements
### Requirement: Core Spotify Tables
The system SHALL define core Spotify domain tables for songs and playlists using migration v2 naming and constraints.

#### Scenario: Song stored from Spotify
- **WHEN** a Spotify song is ingested
- **THEN** store it in `song` with a unique `spotify_id`

#### Scenario: Liked song stored for account
- **WHEN** a user likes a song
- **THEN** create or update `liked_song` with `account_id`, `song_id`, and `liked_at`

#### Scenario: Playlist song linkage
- **WHEN** a playlist is synced
- **THEN** upsert `playlist` and link songs via `playlist_song`

### Requirement: Sync Checkpoint Tracking
The system SHALL persist sync checkpoints in `job.progress` for incremental sync of liked songs and playlists.

#### Scenario: Checkpoint recorded
- **WHEN** a sync completes
- **THEN** store the last cursor or timestamp in `job.progress` for that account and sync type

#### Scenario: Sync resumes from checkpoint
- **WHEN** a sync starts and a checkpoint exists
- **THEN** continue from the stored cursor or timestamp in the latest sync job
