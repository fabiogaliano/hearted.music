## ADDED Requirements

### Requirement: Trigger-scoped enrichment follow-on work

The system SHALL split enrichment follow-on work by product trigger boundary while preserving a backward-compatible full-pipeline wrapper for legacy callers.

#### Scenario: Sync follow-on scope
- **WHEN** `/api/extension/sync` finishes its sync phases successfully
- **THEN** the follow-on workflow SHALL be limited to song-side enrichment for the selected candidate batch
- **AND** destination profiling and matching SHALL remain outside the sync request boundary

#### Scenario: Destination-save follow-on scope
- **WHEN** destination playlists are saved successfully during onboarding
- **THEN** the follow-on workflow SHALL be limited to destination profiling and matching
- **AND** it SHALL NOT rerun song-side enrichment as part of the same trigger

#### Scenario: Backward-compatible wrapper
- **WHEN** an internal caller still invokes the legacy full-pipeline entry point
- **THEN** the system MAY compose song enrichment, destination profiling, and matching sequentially
- **AND** the composed path SHALL preserve explicit skip behavior for stages with no actionable work

#### Scenario: Save response is not a destination-work barrier
- **WHEN** destination playlists are saved successfully
- **THEN** the initiating save response SHALL be allowed to complete before destination profiling and matching finish
- **AND** follow-on failures SHALL be isolated from the successful save response
