## ADDED Requirements

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
