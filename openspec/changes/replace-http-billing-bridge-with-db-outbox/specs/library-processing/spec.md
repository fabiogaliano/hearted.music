## MODIFIED Requirements

### Requirement: Source boundaries emit semantic changes through constructors

Production source boundaries SHALL construct `LibraryProcessingChange` values through the canonical modules under `src/lib/workflows/library-processing/changes/`.

#### Scenario: Production callers avoid ad-hoc change literals
- **WHEN** sync, onboarding, playlist management, billing, the billing domain event consumer, runner settlement, or recovery code emits a library-processing change
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
