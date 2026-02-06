## MODIFIED Requirements

### Requirement: Soft Delete for Liked Songs

The system SHALL use soft delete for unliked songs to preserve timeline history.

#### Scenario: Unliking a song
- **WHEN** user unlikes a song on Spotify
- **THEN** set `unliked_at` timestamp (do not delete row)

#### Scenario: Active songs query
- **WHEN** fetching user's liked songs
- **THEN** filter with `WHERE unliked_at IS NULL`

#### Scenario: Matching status derived from item_status
- **WHEN** a liked song is matched or ignored
- **THEN** the matching status is recorded in `item_status` (not `liked_song.status`)
- **AND** `liked_song` table SHALL NOT have a `status` column

### Requirement: Core Spotify Tables

The system SHALL define core Spotify domain tables for songs and playlists using migration v2 naming and constraints.

#### Scenario: Song stored from Spotify
- **WHEN** a Spotify song is ingested
- **THEN** store `spotify_id`, `name`, `artists` (TEXT[]), `artist_ids` (TEXT[]), `album_name`, `album_id`, `image_url`, `duration_ms`, `popularity`, `preview_url`, `isrc`, and `genres` on `song`

#### Scenario: Song genres stored on song row
- **WHEN** a Spotify song includes genre metadata retrieve via Last.fm API
- **THEN** store the ordered genres array in `song.genres`

#### Scenario: Liked song stored for account
- **WHEN** a user likes a song
- **THEN** create or update `liked_song` with `account_id`, `song_id`, `liked_at`, and `unliked_at`

#### Scenario: Playlist song linkage
- **WHEN** a playlist is synced
- **THEN** upsert `playlist` with `song_count`, `is_destination`, and `image_url`, and link songs via `playlist_song`

### Requirement: Song Extension Tables

The system SHALL store song metadata extensions in dedicated tables with global read access.

#### Scenario: Audio features stored
- **WHEN** ReccoBeats audio features are fetched for a song
- **THEN** store in `song_audio_feature` with acousticness, danceability, energy, etc.

#### Scenario: LLM analysis stored
- **WHEN** LLM analyzes a song
- **THEN** store in `song_analysis` with JSONB analysis, model, prompt_version, tokens_used, and cost_cents

#### Scenario: Multiple analyses per song allowed
- **WHEN** querying the latest analysis for a song
- **THEN** use `ORDER BY created_at DESC LIMIT 1` (not a unique constraint on song_id)

#### Scenario: Embeddings stored with vector type
- **WHEN** embedding is generated for a song
- **THEN** store in `song_embedding` with `kind`, `model`, `model_version`, `dims`, `content_hash`, and `vector(1024)` embedding

### Requirement: Unified Job System

The system SHALL track all background jobs in a single `job` table.

#### Scenario: Single query for active jobs
- **WHEN** checking what jobs are running for a user
- **THEN** query single `job` table with `status = 'running'`

#### Scenario: Job types are distinguished by column
- **WHEN** creating a new job
- **THEN** set `type` column to one of: `sync_liked_songs`, `sync_playlists`, `song_analysis`, `playlist_analysis`, `matching`, `sync_playlist_tracks`

#### Scenario: Progress tracked as JSONB
- **WHEN** updating job progress
- **THEN** update `progress` JSONB column with `{ total, done, succeeded, failed }`

## REMOVED Requirements

### Requirement: liked_song.status column
**Reason**: Sorting status is now derived from `item_status` table. The `liked_song.status` column was never populated by application code, creating a silent data inconsistency. `item_status` already captures richer action data.
**Migration**: All queries that read `liked_song.status` SHALL read from `item_status.action_type` instead. SQL functions `get_liked_songs_page` and `get_liked_songs_stats` are updated to JOIN on `item_status`.
