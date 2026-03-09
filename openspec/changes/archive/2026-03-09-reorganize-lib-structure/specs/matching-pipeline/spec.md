## MODIFIED Requirements

### Requirement: Matching module locations

The system SHALL organize matching pipeline modules under bounded-context domains, workflows, integrations, and platform folders.

#### Scenario: Song matching service location
- **WHEN** song-matching modules are created or updated
- **THEN** they are located under `src/lib/domains/taste/song-matching/*`

#### Scenario: Genre and profiling locations
- **WHEN** genre-tagging or playlist-profiling modules are created or updated
- **THEN** they are located under `src/lib/domains/enrichment/genre-tagging/*` and `src/lib/domains/taste/playlist-profiling/*`

#### Scenario: Analysis and embedding locations
- **WHEN** analysis or embedding helpers are used by matching
- **THEN** they are located under `src/lib/domains/enrichment/content-analysis/*` and `src/lib/domains/enrichment/embeddings/*`

#### Scenario: Enrichment workflow location
- **WHEN** the matching-related enrichment pipeline is referenced
- **THEN** its orchestration modules are located under `src/lib/workflows/enrichment-pipeline/*`

#### Scenario: External provider locations
- **WHEN** Last.fm, ReccoBeats, or LLM provider integrations are referenced by the matching stack
- **THEN** they are located under `src/lib/integrations/lastfm/*`, `src/lib/integrations/reccobeats/*`, and `src/lib/integrations/llm/*`
