# Migration v2 Specification

> Fresh Supabase schema with clean naming, end-to-end type safety, and simplified service architecture.

**Detailed documentation**: `docs/migration_v2/`
- `00-DECISIONS.md` - 56 architectural decisions
- `01-SCHEMA.md` - Database schema definitions
- `02-SERVICES.md` - Service layer changes
- `03-IMPLEMENTATION.md` - Phased implementation plan
- `ROADMAP.md` - Task tracking

---

## Purpose

Define the v2 database schema and service architecture for the Spotify liked songs sorting application. This migration establishes domain-friendly naming conventions, UUID primary keys, a unified job system, and functional query modules to replace repository classes.

---
## Requirements
### Requirement: Domain Language Naming

The system SHALL use user-friendly domain terminology throughout the codebase.

#### Scenario: Entity naming follows user language
- **WHEN** referencing Spotify tracks in the database
- **THEN** use `song` (not `track`) because users say "liked songs"

#### Scenario: Feature naming matches Spotify UI
- **WHEN** referencing saved tracks
- **THEN** use `liked_song` to match Spotify's "Liked Songs" feature name

#### Scenario: Destination playlists are clearly named
- **WHEN** marking playlists for sorting
- **THEN** use `is_destination` (not `is_flagged`) to indicate songs get sorted *into* these playlists

---

### Requirement: UUID Primary Keys

The system SHALL use UUIDs as primary keys for all tables.

#### Scenario: Platform independence
- **WHEN** creating new records
- **THEN** generate UUID primary keys to enable future multi-platform support

#### Scenario: Spotify IDs as indexed columns
- **WHEN** storing Spotify identifiers
- **THEN** store as `spotify_id` TEXT column with UNIQUE index (not as primary key)

---

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
- **THEN** store string step values in `user_preferences.onboarding_step` (e.g., `welcome`, `pick-color`, `connecting`, `syncing`, `flag-playlists`, `ready`, `complete`)

#### Scenario: Preferences table exists
- **WHEN** the schema is initialized
- **THEN** `user_preferences` table exists with account_id, theme, onboarding_step

### Requirement: Query Modules Replace Repositories

The system SHALL use functional query modules instead of repository classes.

#### Scenario: Data access pattern
- **WHEN** accessing database from services
- **THEN** import functions from `data/*.ts` modules (not repository classes)

#### Scenario: Module organization
- **WHEN** organizing data access code
- **THEN** create domain-focused modules: `songs.ts`, `playlists.ts`, `analysis.ts`, `vectors.ts`, `matching.ts`, `jobs.ts`, `accounts.ts`, `newness.ts`, `preferences.ts`

#### Scenario: Analysis module provides song and playlist analysis access
- **WHEN** services need to read or write LLM analysis data
- **THEN** import from `data/analysis.ts` with functions: `getSongAnalysis` (latest, single or batch), `insertSongAnalysis`, `getSongAudioFeatures`, `upsertSongAudioFeatures`, `getPlaylistAnalysis`, `insertPlaylistAnalysis`

#### Scenario: Vectors module provides embedding and profile access
- **WHEN** services need to read or write vector embeddings
- **THEN** import from `data/vectors.ts` with functions: `getSongEmbedding`, `upsertSongEmbedding`, `getPlaylistProfile`, `upsertPlaylistProfile`

#### Scenario: Matching module provides match context and result access
- **WHEN** services need to read or write matching data
- **THEN** import from `data/matching.ts` with functions: `getMatchContext`, `createMatchContext`, `getMatchResults`, `getMatchResultsForSong`, `insertMatchResults`, `getTopMatchesPerPlaylist`

#### Scenario: Newness module provides item status tracking
- **WHEN** services need to track new/viewed/actioned items
- **THEN** import from `data/newness.ts` with functions: `getNewCounts`, `getNewItemIds`, `markItemsNew`, `markSeen`, `markAllSeen`

#### Scenario: Preferences module provides user preferences access
- **WHEN** services need to read or write user preferences
- **THEN** import from `data/preferences.ts` with functions: `getPreferences`, `updateTheme`, `getOnboardingStep`, `updateOnboardingStep`, `completeOnboarding`

#### Scenario: All query modules return Result types
- **WHEN** any query module function is called
- **THEN** return `Result<T, DbError>` for composable error handling using `better-result`

#### Scenario: Query modules use service role client
- **WHEN** query modules access Supabase
- **THEN** use `createAdminSupabaseClient()` to bypass RLS (custom auth pattern)

### Requirement: DeepInfra API for Vectorization

The system SHALL use DeepInfra hosted APIs instead of local Python vectorization service.

#### Scenario: Embedding generation
- **WHEN** generating embeddings for song analysis
- **THEN** call DeepInfra API with `intfloat/multilingual-e5-large-instruct` model

#### Scenario: Reranking
- **WHEN** reranking match results
- **THEN** call DeepInfra API with `Qwen/Qwen3-Reranker-0.6B` model

#### Scenario: No local Python service
- **WHEN** deploying the application
- **THEN** no Python vectorization service is required

---

### Requirement: SSE for Real-Time Updates

The system SHALL use Server-Sent Events instead of WebSockets for job progress.

#### Scenario: Job progress streaming
- **WHEN** user starts a long-running job
- **THEN** stream progress via SSE endpoint `/api/jobs/$id/progress`

#### Scenario: Cloudflare Workers compatibility
- **WHEN** deploying to edge runtime
- **THEN** SSE works natively (WebSockets are not supported)

---

### Requirement: Row Level Security

The system SHALL enable RLS on all tables and deny direct anon/authenticated access.

#### Scenario: Direct client access blocked
- **WHEN** querying any table with anon/authenticated roles
- **THEN** access is denied (no read/write policies)

#### Scenario: Service role access
- **WHEN** using the service_role key
- **THEN** operations bypass RLS as normal

### Requirement: App-Provided LLM Keys

The system SHALL provide LLM API keys at the app level (no BYOK).

#### Scenario: Simplified user experience
- **WHEN** user starts using the app
- **THEN** no API key configuration is required

#### Scenario: No provider_keys table
- **WHEN** designing the database schema
- **THEN** do not include a `provider_keys` table

---

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

### Requirement: Sync Checkpoint Tracking
The system SHALL persist sync checkpoints in `job.progress` for incremental sync of liked songs and playlists.

#### Scenario: Checkpoint recorded
- **WHEN** a sync completes
- **THEN** store the last cursor or timestamp in `job.progress` for that account and sync type

#### Scenario: Sync resumes from checkpoint
- **WHEN** a sync starts and a checkpoint exists
- **THEN** continue from the stored cursor or timestamp in the latest sync job

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

### Requirement: Factory-Free Service Composition

The system SHALL remove factory modules and instantiate services via direct imports.

#### Scenario: Factory files removed
- **WHEN** building the v2 service layer
- **THEN** no factory modules remain for matching, reranker, embedding, genre, profiling, or LLM providers

#### Scenario: Direct imports used
- **WHEN** a service is needed in a server function or route loader
- **THEN** it is imported directly from its module (no factory indirection)

### Requirement: Analysis Pipeline Orchestrator

The system SHALL provide a merged analysis pipeline orchestrator for song and playlist analysis.

#### Scenario: Song analysis batch
- **WHEN** a song analysis job runs
- **THEN** the pipeline reads songs, calls analysis services, stores results via `data/analysis.ts`, and updates job progress

#### Scenario: Playlist analysis batch
- **WHEN** a playlist analysis job runs
- **THEN** the pipeline reads playlists, calls analysis services, stores results via `data/analysis.ts`, and updates job progress

### Requirement: Sync Orchestration Services

The system SHALL provide `SyncOrchestrator` and `PlaylistSyncService` for Spotify sync workflows.

#### Scenario: Sync liked songs
- **WHEN** a liked songs sync job runs
- **THEN** `SyncOrchestrator` fetches liked songs and upserts records via `data/songs.ts`

#### Scenario: Sync playlists
- **WHEN** a playlists sync job runs
- **THEN** `PlaylistSyncService` upserts playlists and playlist songs via `data/playlists.ts`

### Requirement: DeepInfra Service Integration

The system SHALL provide `DeepInfraService` to handle embeddings and reranking.

#### Scenario: Embedding generation
- **WHEN** an embedding is required for a song
- **THEN** `DeepInfraService` is called and results are stored via `data/vectors.ts`

#### Scenario: Reranking
- **WHEN** reranking is needed for match results
- **THEN** `DeepInfraService` is called with the reranker model and scores are returned for `MatchingService`

## Migration Phases

| Phase | Name                    | Dependencies | Status |
| ----- | ----------------------- | ------------ | ------ |
| 0     | Foundation              | —            | ✅     |
| 1     | Schema DDL              | Phase 0      | ✅     |
| 2     | Extensions & Types      | Phase 1      | ✅     |
| 3     | Query Modules           | Phase 2      | ✅     |
| 4a    | Delete Factories        | Phase 3      | ✅     |
| 4b    | Merge Pipeline          | Phase 3      | ✅     |
| 4c    | Split PlaylistService   | Phase 3      | ✅     |
| 4d    | DeepInfra Migration     | Phase 3      | ✅     |
| 4e    | **Matching Pipeline**   | Phase 4d     | ⬜     |
| 4f    | **Genre Enrichment**    | Phase 4d     | ⬜     |
| 4g    | **Playlist Profiling**  | Phase 4e     | ⬜     |
| 5     | SSE Migration           | Phase 4g     | ⬜     |
| 6     | Cleanup                 | Phase 5      | ⬜     |
| 7     | UI Integration          | Phase 5      | 🟡     |

> **Frontend Note**: UI prototypes are ~85% complete in `old_app/prototypes/warm-pastel/` (88 files). Phase 7 involves wiring these to real APIs/data.

See `docs/migration_v2/ROADMAP.md` for detailed tasks per phase.
