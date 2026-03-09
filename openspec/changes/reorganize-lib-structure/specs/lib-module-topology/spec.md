## ADDED Requirements

### Requirement: Canonical `src/lib` top-level structure

The system SHALL organize core library modules under a canonical topology composed of `src/lib/domains`, `src/lib/workflows`, `src/lib/integrations`, `src/lib/platform`, and `src/lib/shared`.

#### Scenario: New core module placement
- **WHEN** a new core library module is created
- **THEN** it SHALL be placed under one of the canonical top-level folders based on business ownership or platform role

#### Scenario: Legacy implementation-layer folders retired
- **WHEN** the lib reorganization is complete
- **THEN** new modules SHALL NOT be introduced under legacy implementation buckets such as `src/lib/capabilities`, `src/lib/data`, `src/lib/jobs`, or `src/lib/ml`

### Requirement: Domain-owned business modules

The system SHALL place business logic and query modules inside bounded contexts under `src/lib/domains`.

#### Scenario: Library domain ownership
- **WHEN** modules operate on songs, playlists, liked songs, accounts, or preference-derived library state
- **THEN** they SHALL reside under `src/lib/domains/library/*`

#### Scenario: Enrichment and taste domain ownership
- **WHEN** modules operate on lyrics, audio features, content analysis, embeddings, genre tagging, playlist profiling, or song matching
- **THEN** they SHALL reside under `src/lib/domains/enrichment/*` or `src/lib/domains/taste/*` according to ownership

#### Scenario: Future feature family placement
- **WHEN** modules are added for smart playlists, contextual playlists, listener profiles, timelines, or insight cards
- **THEN** they SHALL be placed under the bounded context that owns that capability, such as `src/lib/domains/curation/*` or `src/lib/domains/narrative/*`

### Requirement: Workflow-owned cross-domain orchestration

The system SHALL place cross-domain orchestration entrypoints under `src/lib/workflows`.

#### Scenario: Spotify sync workflow location
- **WHEN** the system coordinates multi-step Spotify ingestion across playlists, liked songs, jobs, and persistence
- **THEN** the orchestration modules SHALL reside under `src/lib/workflows/spotify-sync/*`

#### Scenario: Enrichment pipeline workflow location
- **WHEN** the system coordinates multi-stage enrichment across audio features, analysis, embeddings, profiling, and matching
- **THEN** the orchestration modules SHALL reside under `src/lib/workflows/enrichment-pipeline/*`

### Requirement: Integration, platform, and shared boundaries

The system SHALL separate external providers, internal infrastructure, and pure shared code into dedicated top-level folders.

#### Scenario: External provider adapter placement
- **WHEN** a module talks to Spotify, Genius, Last.fm, ReccoBeats, DeepInfra, HuggingFace, or another external provider
- **THEN** it SHALL reside under `src/lib/integrations/<provider>/*`

#### Scenario: Internal platform module placement
- **WHEN** a module provides auth, jobs, storage, cache, scheduling, or similar app infrastructure
- **THEN** it SHALL reside under `src/lib/platform/*`

#### Scenario: Shared utility placement
- **WHEN** a module contains reusable pure types, errors, or utilities without domain ownership
- **THEN** it SHALL reside under `src/lib/shared/*`
