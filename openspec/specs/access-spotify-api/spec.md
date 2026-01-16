# access-spotify-api Specification

## Purpose
TBD - created by archiving change add-spotify-sdk-services. Update Purpose after archive.
## Requirements
### Requirement: SDK-backed Spotify service

The system SHALL provide a Spotify service backed by the Spotify SDK for API operations.

#### Scenario: Service requested for account
- **WHEN** a server function needs Spotify data for an account
- **THEN** the system creates a Spotify service using that account's tokens
- **AND** the service uses the SDK for API calls

#### Scenario: Token refresh before SDK usage
- **WHEN** the stored access token is expired
- **THEN** the system refreshes the token via the raw token client
- **AND** passes the new access token into the SDK before any API call

---

### Requirement: Raw token client remains source of truth

The system SHALL use the raw fetch client for token exchange and refresh, passing access tokens to the SDK.

#### Scenario: OAuth callback token exchange
- **WHEN** exchanging an authorization code for tokens
- **THEN** the raw client performs the fetch to Spotify's token endpoint
- **AND** stores the results in Supabase

#### Scenario: SDK instantiation
- **WHEN** constructing the Spotify SDK client
- **THEN** the system passes the current access token from Supabase
- **AND** does not rely on the SDK for token refresh

---

### Requirement: Retry and pagination helpers

The system SHALL provide helpers for Spotify pagination and rate-limit retries.

#### Scenario: Rate limit response
- **WHEN** a Spotify request returns HTTP 429 with a Retry-After header
- **THEN** the system waits the specified delay and retries up to the configured maximum

#### Scenario: Multi-page endpoint
- **WHEN** fetching a paginated Spotify endpoint
- **THEN** the system iterates until all pages are fetched or a stop condition is met

---

### Requirement: Service module location

The system SHALL place service modules under `src/lib/services`.

#### Scenario: Spotify service organization
- **WHEN** Spotify service modules are created or updated
- **THEN** they are located under `src/lib/services/spotify`

#### Scenario: Existing service module relocation
- **WHEN** a service module exists outside `src/lib/services`
- **THEN** it is moved into `src/lib/services` and imports are updated

---

### Requirement: Refresh coordination

The system SHALL deduplicate concurrent token refreshes per account.

#### Scenario: Parallel Spotify requests
- **WHEN** multiple requests detect an expired token for the same account
- **THEN** only one refresh is performed
- **AND** other requests await the in-flight refresh result

