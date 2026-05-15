## ADDED Requirements

### Requirement: Library-processing apply reports typed outcomes

The library-processing apply interface SHALL report success or expected failure as typed Result values instead of hiding scheduling failures behind logs.

#### Scenario: Successful apply returns reconciled state and effect results
- **WHEN** `applyLibraryProcessingChange(...)` loads state, reconciles a change, persists state, executes required effects, and persists final active-job references
- **THEN** it SHALL return a success result containing the reconciled state and the attempted effect outcomes
- **AND** callers SHALL NOT infer success from absence of a thrown exception

#### Scenario: State persistence failure returns a typed error
- **WHEN** the apply flow cannot load or persist `library_processing_state`
- **THEN** it SHALL return a typed error describing the failed step and the underlying database error
- **AND** it SHALL NOT return a success-shaped value

#### Scenario: Effect execution failure returns a typed error
- **WHEN** reconciliation requires an `ensure_enrichment_job` or `ensure_match_snapshot_refresh_job` effect and the job cannot be ensured
- **THEN** the apply flow SHALL return a typed effect error
- **AND** the caller SHALL be able to decide whether the source operation should fail, log, or retry

### Requirement: Source boundaries emit semantic changes through constructors

Production source boundaries SHALL construct `LibraryProcessingChange` values through the canonical modules under `src/lib/workflows/library-processing/changes/`.

#### Scenario: Production callers avoid ad-hoc change literals
- **WHEN** sync, onboarding, playlist management, billing, billing bridge, runner settlement, or recovery code emits a library-processing change
- **THEN** it SHALL use the matching change-constructor module
- **AND** it SHALL NOT construct ad-hoc `LibraryProcessingChange` object literals at that production boundary

#### Scenario: Constructors preserve exact union-member shape
- **WHEN** a change factory is updated or a new change kind is added
- **THEN** the factory SHALL return the exact `LibraryProcessingChange` union member for that kind
- **AND** missing required fields SHALL fail at compile time at the constructor seam

#### Scenario: Recovery uses the same worker outcome constructors
- **WHEN** dead-letter or terminal-ref recovery maps a job row back to a library-processing outcome
- **THEN** it SHALL create the change with `EnrichmentChanges` or `MatchSnapshotChanges`
- **AND** recovery semantics SHALL stay aligned with normal runner settlement semantics

### Requirement: Terminal job recovery uses library-processing changes

The system SHALL repair active-job references for terminal jobs by applying library-processing changes rather than mutating `library_processing_state` directly.

#### Scenario: Failed terminal enrichment job maps to stopped change
- **WHEN** recovery observes an `enrichment` job in terminal failed state while it is still referenced as active
- **THEN** recovery SHALL apply an `enrichment_stopped` change for that job
- **AND** reconciliation SHALL clear the active job reference and leave enrichment stale

#### Scenario: Failed terminal refresh job maps to failed change
- **WHEN** recovery observes a `match_snapshot_refresh` job in terminal failed state while it is still referenced as active
- **THEN** recovery SHALL apply a `match_snapshot_failed` change for that job
- **AND** reconciliation SHALL clear the active job reference and leave refresh stale

#### Scenario: Completed terminal job settlement is reconstructed when durable details exist
- **WHEN** recovery observes a completed active job reference and durable execution measurement details exist for that job
- **THEN** recovery SHALL reconstruct and apply the same completion change the runner would have applied
- **AND** successful settlement SHALL use the job's stored `satisfies_requested_at` marker

#### Scenario: Completed terminal job without reconstructable details is conservative
- **WHEN** recovery observes a completed active job reference but cannot reconstruct the completion details safely
- **THEN** recovery SHALL clear the active reference conservatively and leave the workflow stale
- **AND** it SHALL prefer duplicate safe background work over a permanently wedged workflow

### Requirement: Library-processing callers handle apply outcomes explicitly

Callers that emit library-processing changes SHALL handle the returned Result at their seam.

#### Scenario: Extension sync fails loudly when scheduling fails
- **WHEN** `/api/extension/sync` successfully persists library data but applying the aggregated `library_synced` change fails
- **THEN** the route SHALL return a failure response that includes the sync phase job IDs
- **AND** it SHALL make clear that background enrichment or refresh work may not have been scheduled

#### Scenario: Worker settlement records settlement status
- **WHEN** a worker runner marks a job terminal and attempts the corresponding library-processing settlement
- **THEN** the runner outcome SHALL distinguish successful settlement from settlement failure
- **AND** settlement failure SHALL be recoverable by the terminal active-ref recovery path
