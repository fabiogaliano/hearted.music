## REMOVED Requirements

### Requirement: SDK-backed Spotify service
**Reason**: User-scoped Spotify API access is no longer available via OAuth tokens. All user-scoped data (liked songs, playlists, playlist tracks) now comes from the Chrome extension's Pathfinder pipeline.
**Migration**: `getSpotifyService(accountId)` removed for user-scoped operations. Extension sync endpoint (`/api/extension/sync`) receives pre-fetched data instead. Code in `src/lib/integrations/spotify/service.ts` and `src/lib/integrations/spotify/index.ts` no longer used for initial sync.

### Requirement: Raw token client remains source of truth
**Reason**: No Spotify OAuth tokens are exchanged or refreshed server-side. The extension handles its own Spotify session tokens (intercepted from the browser, not from our OAuth flow).
**Migration**: Token exchange (`exchangeCodeForTokens`) and refresh (`performTokenRefresh`) in `src/lib/integrations/spotify/client.ts` are removed. The extension manages Spotify authentication independently.

### Requirement: Refresh coordination
**Reason**: No server-side token refresh needed. Extension manages its own intercepted Spotify tokens.
**Migration**: Refresh deduplication logic in `src/lib/integrations/spotify/client.ts` removed.

## MODIFIED Requirements

### Requirement: Retry and pagination helpers

The system SHALL provide helpers for Spotify pagination and rate-limit retries for app-level API access only.

#### Scenario: Rate limit response on app-level requests
- **WHEN** a Spotify request using the app-level Client Credentials token returns HTTP 429
- **THEN** the system waits the specified Retry-After delay and retries up to the configured maximum

#### Scenario: App-level paginated endpoint
- **WHEN** fetching a paginated Spotify endpoint using Client Credentials
- **THEN** the system iterates until all pages are fetched or a stop condition is met

#### Scenario: User-scoped requests not supported
- **WHEN** a user-scoped Spotify API request is needed
- **THEN** the system SHALL NOT attempt the request via server-side tokens
- **AND** the data SHALL come from the extension sync pipeline instead

---

### Requirement: Service module location

The system SHALL place Spotify integration modules under `src/lib/integrations`.

#### Scenario: Spotify service organization
- **WHEN** Spotify integration modules are created or updated
- **THEN** they are located under `src/lib/integrations/spotify`

#### Scenario: App-level auth module
- **WHEN** Client Credentials flow modules are referenced
- **THEN** they reside in `src/lib/integrations/spotify/app-auth.ts`

## ADDED Requirements

### Requirement: App-Level Client Credentials Fallback

The system SHALL maintain the Client Credentials flow for non-user-scoped Spotify API access if available.

#### Scenario: Album art lookup
- **WHEN** album artwork is needed for display
- **AND** Client Credentials access is still available
- **THEN** the system uses the `app_token` to fetch album data from Spotify's public API

#### Scenario: Client Credentials revoked
- **WHEN** Spotify revokes Client Credentials access
- **THEN** the system falls back to album art URLs cached from extension sync data
- **AND** does not attempt Spotify API calls

#### Scenario: App token refresh
- **WHEN** the app-level access token expires
- **THEN** the system refreshes it via the Client Credentials flow
- **AND** stores the new token in the `app_token` table
