## ADDED Requirements
### Requirement: Result-Based Spotify Service Errors
The system SHALL return Result values from Spotify service operations instead of throwing.

#### Scenario: Spotify request failure
- **WHEN** a Spotify API call fails in the service layer
- **THEN** the operation returns `Result.err(SpotifyError)`

#### Scenario: Paginated fetch success
- **WHEN** the service fetches a paginated Spotify collection
- **THEN** it returns `Result.ok(items)` composed with shared pagination helpers

### Requirement: Spotify Retry Policy
The system SHALL centralize Spotify API retry handling with rate limit awareness.

#### Scenario: Rate limited retry
- **WHEN** a Spotify API call returns HTTP 429 with `Retry-After`
- **THEN** the helper waits and retries up to a configured limit
