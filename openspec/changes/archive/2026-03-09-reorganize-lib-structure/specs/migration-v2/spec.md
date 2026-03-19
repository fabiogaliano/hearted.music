## MODIFIED Requirements

### Requirement: Query Modules Replace Repositories

The system SHALL use functional query modules owned by bounded contexts instead of repository classes.

#### Scenario: Data access pattern
- **WHEN** accessing database from services or workflows
- **THEN** import functions from domain query modules under `src/lib/domains/**` (not repository classes and not a shared `src/lib/data` bucket)

#### Scenario: Module organization
- **WHEN** organizing data access code
- **THEN** create domain-focused query modules such as `src/lib/domains/library/songs/queries.ts`, `src/lib/domains/library/playlists/queries.ts`, `src/lib/domains/library/liked-songs/queries.ts`, and `src/lib/domains/library/accounts/queries.ts`

#### Scenario: Analysis module provides song and playlist analysis access
- **WHEN** services need to read or write LLM analysis data
- **THEN** import from enrichment-domain query modules such as `src/lib/domains/enrichment/content-analysis/song-analysis-queries.ts` and `src/lib/domains/enrichment/content-analysis/playlist-analysis-queries.ts`

#### Scenario: Vector and profile modules provide embedding and profile access
- **WHEN** services need to read or write song embeddings or playlist profiles
- **THEN** import from `src/lib/domains/enrichment/embeddings/queries.ts` and `src/lib/domains/taste/playlist-profiling/queries.ts`

#### Scenario: Matching module provides match context and result access
- **WHEN** services need to read or write matching data
- **THEN** import from `src/lib/domains/taste/song-matching/queries.ts`

#### Scenario: Newness module provides item status tracking
- **WHEN** services need to track new, viewed, or actioned items
- **THEN** import from `src/lib/domains/library/liked-songs/status-queries.ts`

#### Scenario: Preferences module provides user preferences access
- **WHEN** services need to read or write user preferences
- **THEN** import from `src/lib/domains/library/accounts/preferences-queries.ts`

#### Scenario: All query modules return Result types
- **WHEN** any query module function is called
- **THEN** return `Result<T, DbError>` for composable error handling using `better-result`

#### Scenario: Query modules use service role client
- **WHEN** query modules access Supabase
- **THEN** use the platform storage/admin client for service-role access

## MODIFIED Requirements

### Requirement: Analysis Pipeline Orchestrator

The system SHALL provide a merged analysis pipeline orchestrator within the enrichment domain.

#### Scenario: Song analysis batch
- **WHEN** a song analysis job runs
- **THEN** the orchestrator reads songs, calls analysis services, stores results via enrichment-domain query modules, and updates job progress

#### Scenario: Playlist analysis batch
- **WHEN** a playlist analysis job runs
- **THEN** the orchestrator reads playlists, calls analysis services, stores results via enrichment-domain query modules, and updates job progress

#### Scenario: Analysis orchestrator location
- **WHEN** the analysis orchestration module is referenced
- **THEN** it resides under `src/lib/domains/enrichment/content-analysis/orchestrator.ts`

## MODIFIED Requirements

### Requirement: Sync Orchestration Services

The system SHALL provide Spotify sync workflow modules that coordinate library ingestion.

#### Scenario: Sync workflow location
- **WHEN** Spotify sync orchestration modules are created or updated
- **THEN** they reside under `src/lib/workflows/spotify-sync/*`

#### Scenario: Sync liked songs
- **WHEN** a liked songs sync job runs
- **THEN** `SyncOrchestrator` fetches liked songs and upserts records via library-domain query modules

#### Scenario: Sync playlists
- **WHEN** a playlists sync job runs
- **THEN** `PlaylistSyncService` upserts playlists and playlist songs via library-domain query modules
