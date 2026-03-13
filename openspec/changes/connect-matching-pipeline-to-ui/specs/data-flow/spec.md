## ADDED Requirements

### Requirement: Job chaining pattern

The system SHALL support dependency-ordered job chains where multiple jobs run within a single request, including safe parallel prep work.

#### Scenario: Chain execution
- **WHEN** multiple enrichment stages need to run within one sync request
- **THEN** each stage SHALL create its own job record
- **AND** stages SHALL execute in dependency order
- **AND** stages without direct dependencies MAY run in parallel before the next dependent phase begins

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

#### Scenario: Stage-keyed pipeline job IDs
- **WHEN** the enrichment pipeline runs after sync
- **THEN** the response SHALL include pipeline job IDs under `pipelineJobIds` (separate from `phaseJobIds`)
- **AND** each key SHALL correspond to a pipeline stage such as `audio_features`, `genre_tagging`, `playlist_profiling`, `song_analysis`, `song_embedding`, or `matching`

#### Scenario: Pipeline not run
- **WHEN** the pipeline has no stage jobs to report (for example, an empty batch)
- **THEN** `pipelineJobIds` SHALL still be present in the response
- **AND** it MAY be an empty object
