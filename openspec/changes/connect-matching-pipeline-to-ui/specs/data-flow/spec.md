## ADDED Requirements

### Requirement: Job chaining pattern

The system SHALL support sequential job chains where multiple jobs run in dependency order within a single request.

#### Scenario: Chain execution
- **WHEN** multiple stages need to run sequentially (e.g., analysis → embedding → matching)
- **THEN** each stage SHALL create its own job record
- **AND** stages SHALL execute in order, each starting after the previous completes

#### Scenario: Chain progress tracking
- **WHEN** a job chain is running
- **THEN** the initiating request SHALL collect all job IDs
- **AND** return them in the response so the UI can subscribe to each job's SSE progress independently

#### Scenario: Chain failure isolation
- **WHEN** one job in the chain fails
- **THEN** subsequent jobs SHALL still attempt execution
- **AND** each job's status is independent (a failed analysis job does not mark the embedding job as failed)

---

### Requirement: Pipeline job IDs in sync response

The sync endpoint SHALL return pipeline job IDs alongside sync phase job IDs.

#### Scenario: Extended phaseJobIds
- **WHEN** the enrichment pipeline runs after sync
- **THEN** the response SHALL include pipeline job IDs under `pipelineJobIds` (separate from `phaseJobIds`)
- **AND** each key SHALL correspond to a pipeline stage: `audio_features`, `song_analysis`, `song_embedding`, `playlist_profiling`, `matching`

#### Scenario: Pipeline not run
- **WHEN** the pipeline is skipped (e.g., no liked songs)
- **THEN** `pipelineJobIds` SHALL be `null` in the response
