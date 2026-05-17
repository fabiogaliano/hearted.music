## ADDED Requirements

### Requirement: Enrichment stages report structured per-song outcomes

Each enrichment stage SHALL report attempted, succeeded, skipped, and failed song IDs through a structured outcome interface, and the worker SHALL derive progress counts from those IDs.

#### Scenario: Stage success resolves prior non-terminal failures
- **WHEN** a stage reports one or more succeeded song IDs
- **THEN** the stage accounting module SHALL resolve prior unresolved non-terminal failure rows for those song IDs and that stage
- **AND** the stage implementation SHALL NOT duplicate that resolution logic inline

#### Scenario: Stage failures create durable failure rows
- **WHEN** a stage reports failed song IDs with failure codes
- **THEN** the stage accounting module SHALL record durable `job_failure` rows for each failed song
- **AND** failure policy SHALL decide terminal status and suppression windows from the centralized failure-policy module

#### Scenario: Progress counts are derived from structured outcomes
- **WHEN** a stage outcome is finalized
- **THEN** the job progress summary SHALL derive `total`, `succeeded`, and `failed` from the finalized outcome
- **AND** it SHALL NOT rely on stage-local ad-hoc count objects as the source of truth

#### Scenario: Illegal outcome shapes are rejected
- **WHEN** a stage reports the same song ID as both succeeded and failed
- **THEN** the system SHALL reject the outcome in tests and development mode
- **AND** it SHALL treat the rejected outcome as a stage accounting error rather than a successful stage

### Requirement: Stage-wide exceptions expand to per-candidate retryable failures

The worker SHALL convert a thrown stage handler into per-song retryable failures for every candidate offered to that stage.

#### Scenario: Thrown stage does not undercount failures
- **WHEN** a stage handler throws before returning an outcome
- **AND** the orchestrator offered N candidate song IDs to that stage
- **THEN** the finalized stage summary SHALL report N failed items
- **AND** the system SHALL record a non-terminal failure row for each candidate song ID

#### Scenario: Thrown stage preserves operational context
- **WHEN** a stage-wide exception is converted into per-song failures
- **THEN** each failure row SHALL include the stage name, a retryable failure code, and the original error message when available
- **AND** future selector passes SHALL honor the resulting suppression window

### Requirement: Stage accounting persistence is required for successful progress

The worker SHALL only report stage progress as successful after the durable stage accounting path has completed.

#### Scenario: Failure-row persistence failure fails the parent attempt
- **WHEN** a stage outcome includes failed song IDs
- **AND** the accounting module cannot persist the required `job_failure` rows or suppression state
- **THEN** the parent enrichment attempt SHALL fail rather than return success-shaped stage counts
- **AND** the runner SHALL handle the attempt through the normal failed-job settlement path

#### Scenario: Prior-failure resolution failure is not hidden by successes
- **WHEN** a stage outcome includes succeeded song IDs with prior non-terminal failures
- **AND** resolving those prior failure rows fails
- **THEN** the stage accounting result SHALL be an error
- **AND** the job progress SHALL NOT claim those successes as durably finalized

### Requirement: Parent enrichment job owns all worker-stage accounting

A worker-claimed `enrichment` job SHALL be the only job row used for the chunk's stage progress, failure rows, and execution measurement.

#### Scenario: Song analysis inside enrichment does not create child jobs
- **WHEN** the `song_analysis` stage runs as part of a worker-claimed `enrichment` job
- **THEN** it SHALL use the parent enrichment job ID for failure rows and progress
- **AND** it SHALL NOT create a standalone `song_analysis` job row for that stage run

#### Scenario: Execution measurement summarizes the parent chunk
- **WHEN** an enrichment attempt finishes
- **THEN** the execution measurement SHALL summarize the parent enrichment chunk
- **AND** child stage internals SHALL NOT create separate job measurements for the same chunk

### Requirement: Content activation is an accounted enrichment stage

The content activation step SHALL be represented as an enrichment stage with progress, durable failures, and retry behavior.

#### Scenario: Successful activation marks offered songs succeeded
- **WHEN** content activation persists the account-visible state required for offered song IDs
- **THEN** the content activation outcome SHALL report those song IDs as succeeded
- **AND** prior non-terminal `content_activation` failures for those IDs SHALL be resolved

#### Scenario: Activation persistence failure is retryable
- **WHEN** item-status persistence, unlimited activation RPC, or self-hosted unlock persistence fails for offered song IDs
- **THEN** the content activation outcome SHALL report retryable failures for those song IDs
- **AND** the failure code SHALL suppress immediate hot retries without marking the songs terminal

#### Scenario: Missing subscription provenance does not silently activate
- **WHEN** an account has subscription unlimited access but required subscription provenance is missing
- **THEN** content activation SHALL report retryable failures for the offered song IDs
- **AND** it SHALL NOT silently fall back to item-status-only activation for those IDs
