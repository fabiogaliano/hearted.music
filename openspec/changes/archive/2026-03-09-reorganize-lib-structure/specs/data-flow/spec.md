## MODIFIED Requirements

### Requirement: Job lifecycle module location

The system SHALL define job lifecycle helpers under the platform jobs module.

#### Scenario: Job lifecycle service location
- **WHEN** job lifecycle helpers are referenced
- **THEN** they reside in `src/lib/platform/jobs/lifecycle.ts`

#### Scenario: Job progress helper location
- **WHEN** job progress helpers are referenced
- **THEN** they reside under `src/lib/platform/jobs/progress/*`
