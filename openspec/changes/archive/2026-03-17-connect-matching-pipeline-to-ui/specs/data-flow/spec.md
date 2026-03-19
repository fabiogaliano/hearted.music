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
- **THEN** the initiating request SHALL collect the sync phase job IDs for response persistence and SSE subscription
- **AND** pipeline-stage job creation MAY remain internal to the pipeline implementation

#### Scenario: Chain failure isolation
- **WHEN** one job in the chain fails
- **THEN** subsequent jobs SHALL still attempt execution
- **AND** each job's status is independent (a failed analysis job does not mark the embedding job as failed)

---

### Requirement: Sync response exposes phase job IDs only

The sync endpoint SHALL return sync phase job IDs needed by onboarding and SSE progress tracking.

#### Scenario: Phase job IDs in response
- **WHEN** the extension sync endpoint returns successfully
- **THEN** the response SHALL include `phaseJobIds`
- **AND** it SHALL NOT need to expose separate pipeline job IDs for internal enrichment stages
