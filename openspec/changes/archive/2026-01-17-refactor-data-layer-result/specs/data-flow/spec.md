## ADDED Requirements
### Requirement: Result-Based Query Modules
The system SHALL return Result types from `lib/data/*` modules and not throw.

#### Scenario: Query module failure
- **WHEN** a Supabase query in `lib/data/*` fails
- **THEN** the function returns `Result.err(DbError)` and does not throw

### Requirement: Pipeline Composition
The system SHALL compose multi-step operations with `Result.gen()` (or equivalent).

#### Scenario: Multi-step pipeline
- **WHEN** a pipeline step depends on multiple fallible operations
- **THEN** the operations are composed with `Result.gen()` (or equivalent) to return a single `Result<T, E>`

### Requirement: Boundary Translation for TanStack Start
The system SHALL translate Result failures at server-function or route boundaries into TanStack Start-friendly outcomes.

#### Scenario: Auth redirect
- **WHEN** a Result error indicates authentication is required
- **THEN** the handler throws `redirect()` to the OAuth route

#### Scenario: Structured error response
- **WHEN** a Result error is non-auth and recoverable
- **THEN** the handler returns a typed error payload for UI handling
