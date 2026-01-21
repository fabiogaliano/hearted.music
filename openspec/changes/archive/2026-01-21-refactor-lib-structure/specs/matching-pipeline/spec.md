## ADDED Requirements

### Requirement: Matching module locations

The system SHALL organize matching pipeline modules under the capability, integration, and ML folders.

#### Scenario: Matching service location
- **WHEN** matching modules are created or updated
- **THEN** they are located under `src/lib/capabilities/matching`

#### Scenario: Genre and profiling locations
- **WHEN** genre or profiling modules are created or updated
- **THEN** they are located under `src/lib/capabilities/genre` and `src/lib/capabilities/profiling`

#### Scenario: Embedding utilities location
- **WHEN** embedding helpers are used by matching
- **THEN** they are located under `src/lib/ml/embedding`

#### Scenario: External provider locations
- **WHEN** Last.fm or ReccoBeats integrations are referenced
- **THEN** they are located under `src/lib/integrations/lastfm` and `src/lib/integrations/reccobeats`
