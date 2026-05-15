## ADDED Requirements

### Requirement: Worker recovery repairs terminal library-processing active refs

The worker SHALL repair `library_processing_state` active-job references that point at terminal library-processing jobs so stale workflows do not remain wedged behind completed or failed job rows.

#### Scenario: Dead-lettered enrichment job clears active reference
- **WHEN** the stale-job sweep marks an `enrichment` job as `failed` because it exhausted attempts
- **THEN** the worker SHALL apply the corresponding library-processing failure change
- **AND** the enrichment workflow's active job reference SHALL be cleared
- **AND** the enrichment workflow SHALL remain stale rather than being marked settled

#### Scenario: Dead-lettered refresh job clears active reference
- **WHEN** the stale-job sweep marks a `match_snapshot_refresh` job as `failed` because it exhausted attempts
- **THEN** the worker SHALL apply the corresponding library-processing failure change
- **AND** the match snapshot refresh workflow's active job reference SHALL be cleared
- **AND** the workflow SHALL remain stale rather than being marked settled

#### Scenario: Startup recovery handles pre-existing failed active refs
- **WHEN** the worker starts and finds a `library_processing_state` active job reference that points at a failed `enrichment` or `match_snapshot_refresh` job
- **THEN** the worker SHALL repair that state through the same library-processing change interface used by normal worker outcomes
- **AND** the worker SHALL NOT update `library_processing_state` directly outside that interface

#### Scenario: Completed active refs are reconstructed from durable measurements
- **WHEN** the worker finds an active job reference pointing at a completed library-processing job that was not settled in state
- **THEN** the worker SHALL reconstruct the settlement change from the terminal job row and durable execution measurement details when possible
- **AND** if the measurement details are missing or invalid, it SHALL clear the active reference conservatively and leave the workflow stale for later retry

### Requirement: Worker sweep orchestration is testable without process startup

The worker SHALL expose sweep, dead-letter, and recovery orchestration through a module seam that can be exercised by tests without launching the full Bun worker process.

#### Scenario: Sweep tick invokes stale reset and dead-letter passes
- **WHEN** the sweep tick runs
- **THEN** it SHALL call the stale reset and dead-letter operations for library-processing jobs
- **AND** it SHALL call the equivalent stale reset and dead-letter operations for walkthrough preview jobs

#### Scenario: Dead-letter results feed recovery
- **WHEN** a sweep tick receives dead-lettered library-processing jobs
- **THEN** it SHALL pass each dead-lettered job to the library-processing recovery module
- **AND** recovery failures SHALL be logged as structured errors without preventing the remaining jobs from being processed

### Requirement: Job work modules expose role-specific interfaces

Job work orchestration SHALL be organized behind role-specific module interfaces instead of one shallow catch-all job data module.

#### Scenario: Raw job row operations are separate from queue policy
- **WHEN** code needs to read, update, heartbeat, or mark a job row terminal
- **THEN** it SHALL import from the raw job repository module
- **AND** it SHALL NOT need to import queue claim, sweep, or workflow ensure helpers

#### Scenario: Library-processing queue policy is separate from sync phase jobs
- **WHEN** worker polling claims, sweeps, or dead-letters `enrichment` and `match_snapshot_refresh` jobs
- **THEN** it SHALL import from the library-processing queue module
- **AND** sync-phase jobs SHALL use a separate interface that does not expose worker-claimed queue policy

#### Scenario: Walkthrough preview queue policy stays isolated
- **WHEN** worker polling claims or recovers `walkthrough_match_preview` jobs
- **THEN** it SHALL use the walkthrough preview queue module
- **AND** walkthrough preview queue behavior SHALL NOT share active-job state with production library-processing workflows
