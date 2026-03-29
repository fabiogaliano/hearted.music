## MODIFIED Requirements

### Requirement: Re-match is Separate from Pipeline
The system SHALL keep standalone re-match retired and route profile-side refresh through library-processing-managed `match_snapshot_refresh` jobs while liked-song enrichment remains candidate-side only.

#### Scenario: Profile-side refresh runs through match snapshot jobs
- **WHEN** the system needs fresher published suggestions after sync, onboarding, or worker outcomes
- **THEN** it SHALL rely on library-processing-managed `match_snapshot_refresh` jobs
- **AND** liked-song enrichment SHALL remain focused on candidate-side processing only

### Requirement: Re-match Trigger Integration
The system SHALL replace legacy re-match trigger integration with library-processing change application and scheduler-owned refresh re-ensure.

#### Scenario: Refresh follow-on is scheduler-owned
- **WHEN** sync, onboarding, or a worker outcome makes published suggestions stale
- **THEN** the system SHALL apply library-processing changes so reconciliation can ensure `match_snapshot_refresh`
- **AND** it SHALL not create `rematch` jobs or use `rerunRequested` loops to request later passes