## ADDED Requirements
### Requirement: Tagged Error Taxonomy
The system SHALL define TaggedError subclasses for external API failures and job pipeline failures.

#### Scenario: External API tagging
- **WHEN** Spotify or DeepInfra API calls fail
- **THEN** the error is mapped to a TaggedError with a stable `_tag` and message

#### Scenario: Job failure capture
- **WHEN** a pipeline step fails during a job
- **THEN** the error includes context suitable for `job_failure` records

### Requirement: Result Helper Utilities
The system SHALL provide shared Result helpers that wrap Supabase and external API calls.

#### Scenario: Supabase error mapping
- **WHEN** a helper wraps a Supabase query that fails
- **THEN** it returns `Result.err(TaggedError)` and does not throw

#### Scenario: External API error mapping
- **WHEN** a helper wraps an external API call that fails
- **THEN** it returns `Result.err(TaggedError)` with a stable `_tag`
