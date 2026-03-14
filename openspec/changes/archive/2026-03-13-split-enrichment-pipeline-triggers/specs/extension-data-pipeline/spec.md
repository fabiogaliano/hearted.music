## MODIFIED Requirements

### Requirement: Extension as Primary Data Source

The system SHALL use the Chrome extension as the primary mechanism for ingesting Spotify data and triggering only the follow-on enrichment work that belongs to the sync boundary.

#### Scenario: Extension syncs liked songs to backend
- **WHEN** the extension triggers a sync
- **THEN** it fetches liked songs via Spotify's Pathfinder API
- **AND** POSTs the data to `/api/extension/sync` with `Authorization: Bearer <token>` header
- **AND** the backend validates the bearer token and writes data to the database

#### Scenario: Extension syncs playlists to backend
- **WHEN** the extension triggers a sync
- **THEN** it fetches user-owned playlists via Pathfinder API
- **AND** includes playlist data in the POST to `/api/extension/sync`
- **AND** the backend upserts playlist records for the authenticated user

#### Scenario: Sync triggers only song-side enrichment
- **WHEN** `/api/extension/sync` completes its persistence phases successfully
- **THEN** the system SHALL trigger only the song-side enrichment follow-on work for the account
- **AND** that follow-on work SHALL be limited to `audio_features`, `genre_tagging`, `song_analysis`, and `song_embedding`
- **AND** it SHALL NOT require `playlist_profiling` or `matching` as part of the sync request path

#### Scenario: No Spotify OAuth tokens required
- **WHEN** data ingestion occurs
- **THEN** the system SHALL NOT require Spotify OAuth access tokens stored server-side
- **AND** all Spotify data flows exclusively through the extension's intercepted session tokens
