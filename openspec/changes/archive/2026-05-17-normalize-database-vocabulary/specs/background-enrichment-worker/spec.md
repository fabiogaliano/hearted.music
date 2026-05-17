## MODIFIED Requirements

### Requirement: Terminal per-song failure exclusion

The worker SHALL record terminal per-song failures in `job_item_failure` and exclude those songs from automatic background reprocessing until they are explicitly retried or cleared.

#### Scenario: Terminal song failure is recorded
- **WHEN** a song fails enrichment with a non-retryable error classification
- **THEN** the system SHALL record that failure in `job_item_failure` against the current job and song item
- **AND** the failure record SHALL remain queryable for operator visibility

#### Scenario: Terminally failed songs are skipped by later chunk selection
- **WHEN** future chunks are selected for the same account
- **THEN** songs previously marked with terminal enrichment failures in `job_item_failure` SHALL be excluded from automatic chunk selection
- **AND** other eligible songs SHALL continue processing normally

#### Scenario: Manual retry re-enables a terminally failed song
- **WHEN** an operator or future retry flow clears a song's terminal failure state
- **THEN** that song SHALL become eligible for later chunk selection again

### Requirement: Enrichment stages report structured per-song outcomes

Each enrichment stage SHALL report attempted, succeeded, skipped, and failed song IDs through a structured outcome interface, and the worker SHALL derive progress counts from those IDs.

#### Scenario: Stage success resolves prior non-terminal failures
- **WHEN** a stage reports one or more succeeded song IDs
- **THEN** the stage accounting module SHALL resolve prior unresolved non-terminal `job_item_failure` rows for those song IDs and that stage
- **AND** the stage implementation SHALL NOT duplicate that resolution logic inline

#### Scenario: Stage failures create durable failure rows
- **WHEN** a stage reports failed song IDs with failure codes
- **THEN** the stage accounting module SHALL record durable `job_item_failure` rows for each failed song
- **AND** failure policy SHALL decide terminal status and suppression windows from the centralized failure-policy module

### Requirement: Stage accounting persistence is required for successful progress

The worker SHALL only report stage progress as successful after the durable stage accounting path has completed.

#### Scenario: Failure-row persistence failure fails the parent attempt
- **WHEN** a stage outcome includes failed song IDs
- **AND** the accounting module cannot persist the required `job_item_failure` rows or suppression state
- **THEN** the parent enrichment attempt SHALL fail rather than return success-shaped stage counts
- **AND** the runner SHALL handle the attempt through the normal failed-job settlement path

#### Scenario: Prior-failure resolution failure is not hidden by successes
- **WHEN** a stage outcome includes succeeded song IDs with prior non-terminal failures
- **AND** resolving those prior failure rows fails
- **THEN** the stage accounting result SHALL be an error
- **AND** the job progress SHALL NOT claim those successes as durably finalized
