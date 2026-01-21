## ADDED Requirements

### Requirement: Job lifecycle module location

The system SHALL define job lifecycle helpers under the jobs module.

#### Scenario: Job lifecycle service location
- **WHEN** job lifecycle helpers are referenced
- **THEN** they reside in `src/lib/jobs/lifecycle.ts`

### Requirement: Retry utility module location

The system SHALL define Result retry utilities under shared utils.

#### Scenario: Retry helper location
- **WHEN** `withRetry` is referenced
- **THEN** it resides in `src/lib/shared/utils/result-wrappers/generic.ts`
