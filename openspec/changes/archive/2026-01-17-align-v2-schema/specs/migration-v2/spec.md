## MODIFIED Requirements

### Requirement: Unified Job System

The system SHALL track all background jobs in a single `job` table.

#### Scenario: Single query for active jobs
- **WHEN** checking what jobs are running for a user
- **THEN** query single `job` table with `status = 'running'`

#### Scenario: Job types are distinguished by column
- **WHEN** creating a new job
- **THEN** set `type` column to one of: `sync_liked_songs`, `sync_playlists`, `song_analysis`, `playlist_analysis`, `matching`

#### Scenario: Progress tracked as JSONB
- **WHEN** updating job progress
- **THEN** update `progress` JSONB column with `{ total, done, succeeded, failed }`

### Requirement: Soft Delete for Liked Songs

The system SHALL use soft delete for unliked songs to preserve timeline history.

#### Scenario: Unliking a song
- **WHEN** user unlikes a song on Spotify
- **THEN** set `unliked_at` timestamp (do not delete row)

#### Scenario: Active songs query
- **WHEN** fetching user's liked songs
- **THEN** filter with `WHERE unliked_at IS NULL`

#### Scenario: Sorting status preserved
- **WHEN** a liked song is matched or ignored
- **THEN** store status in `liked_song.status` (`matched` | `ignored` | NULL)

### Requirement: User Preferences Separation

The system SHALL store user preferences in a separate table from account identity.

#### Scenario: Theme storage
- **WHEN** user selects a color theme
- **THEN** store in `user_preferences.theme` (values: blue, green, rose, lavender)

#### Scenario: Onboarding progress
- **WHEN** user progresses through onboarding
- **THEN** store string step values in `user_preferences.onboarding_step` (e.g., `welcome`, `pick-color`, `connecting`, `syncing`, `flag-playlists`, `ready`, `complete`)

#### Scenario: Preferences table exists
- **WHEN** the schema is initialized
- **THEN** `user_preferences` table exists with account_id, theme, onboarding_step

### Requirement: Row Level Security

The system SHALL enable RLS on all tables and deny direct anon/authenticated access.

#### Scenario: Direct client access blocked
- **WHEN** querying any table with anon/authenticated roles
- **THEN** access is denied (no read/write policies)

#### Scenario: Service role access
- **WHEN** using the service_role key
- **THEN** operations bypass RLS as normal

### Requirement: Core Spotify Tables

The system SHALL define core Spotify domain tables for songs and playlists using migration v2 naming and constraints.

#### Scenario: Song stored from Spotify
- **WHEN** a Spotify song is ingested
- **THEN** store `spotify_id`, `name`, `artists` (TEXT[]), `album_name`, `album_id`, `image_url`, `duration_ms`, `popularity`, `preview_url`, `isrc`, and `genres` on `song`

#### Scenario: Song genres stored on song row
- **WHEN** a Spotify song includes genre metadata retrieve via Last.fm API
- **THEN** store the ordered genres array in `song.genres`

#### Scenario: Liked song stored for account
- **WHEN** a user likes a song
- **THEN** create or update `liked_song` with `account_id`, `song_id`, `liked_at`, `unliked_at`, and `status`

#### Scenario: Playlist song linkage
- **WHEN** a playlist is synced
- **THEN** upsert `playlist` with `song_count` and `is_destination`, and link songs via `playlist_song`

### Requirement: Song Extension Tables

The system SHALL store song metadata extensions in dedicated tables with global read access.

#### Scenario: Audio features stored
- **WHEN** ReccoBeats audio features are fetched for a song
- **THEN** store in `song_audio_feature` with acousticness, danceability, energy, etc.

#### Scenario: LLM analysis stored
- **WHEN** LLM analyzes a song
- **THEN** store in `song_analysis` with JSONB analysis, model, prompt_version, tokens_used, and cost_cents

#### Scenario: Embeddings stored with vector type
- **WHEN** embedding is generated for a song
- **THEN** store in `song_embedding` with `kind`, `model`, `model_version`, `dims`, `content_hash`, and `vector(1024)` embedding

### Requirement: Playlist Extension Tables

The system SHALL store playlist analysis and profiles for matching.

#### Scenario: Playlist LLM analysis stored
- **WHEN** LLM analyzes a playlist
- **THEN** store in `playlist_analysis` with JSONB analysis, model, prompt_version, tokens_used, and cost_cents

#### Scenario: Playlist profile stored with vector
- **WHEN** playlist profile is computed
- **THEN** store in `playlist_profile` with `kind`, `model_bundle_hash`, `dims`, `content_hash`, `embedding`, `audio_centroid`, `genre_distribution`, `emotion_distribution`, `song_count`, and `song_ids`

### Requirement: Matching Tables

The system SHALL store match contexts and results for reproducibility.

#### Scenario: Match context captures configuration
- **WHEN** matching is run
- **THEN** create `match_context` with model versions, algorithm version, `config_hash`, `playlist_set_hash`, `candidate_set_hash`, and `context_hash`

#### Scenario: Match results stored per song-playlist pair
- **WHEN** a song is matched to a playlist
- **THEN** store in `match_result` with score, factors JSONB, and rank

### Requirement: Job Failure Tracking

The system SHALL track individual item failures within jobs.

#### Scenario: Failed item recorded
- **WHEN** a song or playlist fails during a job
- **THEN** create `job_failure` with item_type, item_id (UUID), error_type, and error_message
