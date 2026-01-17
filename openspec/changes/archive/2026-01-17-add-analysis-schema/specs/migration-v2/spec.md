## ADDED Requirements

### Requirement: Song Extension Tables

The system SHALL store song metadata extensions in dedicated tables with global read access.

#### Scenario: Audio features stored
- **WHEN** ReccoBeats audio features are fetched for a song
- **THEN** store in `song_audio_feature` with acousticness, danceability, energy, etc.

#### Scenario: LLM analysis stored
- **WHEN** LLM analyzes a song
- **THEN** store in `song_analysis` with JSONB analysis, model name, and token usage

#### Scenario: Embeddings stored with vector type
- **WHEN** embedding is generated for a song
- **THEN** store in `song_embedding` with `vector(1024)` column and HNSW index

#### Scenario: Genre classifications stored
- **WHEN** genres are classified for a song
- **THEN** store in `song_genre` with source, genres array, and optional scores

### Requirement: Playlist Extension Tables

The system SHALL store playlist analysis and profiles for matching.

#### Scenario: Playlist LLM analysis stored
- **WHEN** LLM analyzes a playlist
- **THEN** store in `playlist_analysis` with JSONB analysis, model name, and token usage

#### Scenario: Playlist profile stored with vector
- **WHEN** playlist profile is computed
- **THEN** store in `playlist_profile` with embedding vector, audio centroid, genre/emotion distributions

### Requirement: Matching Tables

The system SHALL store match contexts and results for reproducibility.

#### Scenario: Match context captures configuration
- **WHEN** matching is run
- **THEN** create `match_context` with model versions, algorithm version, and content hashes

#### Scenario: Match results stored per song-playlist pair
- **WHEN** a song is matched to a playlist
- **THEN** store in `match_result` with score, factors JSONB, and rank

### Requirement: Job Failure Tracking

The system SHALL track individual item failures within jobs.

#### Scenario: Failed item recorded
- **WHEN** a song or playlist fails during a job
- **THEN** create `job_failure` with item_type, item_id, error_type, and error_message

## MODIFIED Requirements

### Requirement: Newness Tracking

The system SHALL track "new" status for items to display badges in the UI.

#### Scenario: New songs synced
- **WHEN** new liked songs are synced from Spotify
- **THEN** create `item_status` records with `is_new = true`

#### Scenario: View-based clearing
- **WHEN** user views a new item for 2+ seconds
- **THEN** set `viewed_at` and clear `is_new`

#### Scenario: Action-based clearing
- **WHEN** user adds a song to a playlist
- **THEN** set `actioned_at`, `action_type`, and clear `is_new`

#### Scenario: Item status table exists
- **WHEN** the schema is initialized
- **THEN** `item_status` table exists with account_id, item_type, item_id, is_new, timestamps

### Requirement: User Preferences Separation

The system SHALL store user preferences in a separate table from account identity.

#### Scenario: Theme storage
- **WHEN** user selects a color theme
- **THEN** store in `user_preferences.theme` (values: blue, green, rose, lavender)

#### Scenario: Onboarding progress
- **WHEN** user progresses through onboarding
- **THEN** update `user_preferences.onboarding_step`

#### Scenario: Preferences table exists
- **WHEN** the schema is initialized
- **THEN** `user_preferences` table exists with account_id, theme, onboarding_step
