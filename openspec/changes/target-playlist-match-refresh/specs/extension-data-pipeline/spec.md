## MODIFIED Requirements

### Requirement: Extension as Primary Data Source

The system SHALL use the Chrome extension as the primary mechanism for ingesting Spotify data and triggering only the durable background work required after sync-time change classification.

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

#### Scenario: Sync queues classified background follow-on work
- **WHEN** `/api/extension/sync` completes its persistence phases successfully
- **THEN** the system SHALL create or reuse an active account-scoped `enrichment` background job only when liked-song candidate-side enrichment work is needed
- **AND** it SHALL create or reuse an active account-scoped `target_playlist_match_refresh` job when liked-song removals or target-playlist-side changes require published suggestion refresh
- **AND** that follow-on work SHALL run outside the sync request lifecycle
- **AND** the sync request SHALL NOT wait for either background job to finish

#### Scenario: Liked-song additions rely on enrichment drain for refresh
- **WHEN** sync detects newly added liked songs and no target-playlist-side change requires immediate refresh
- **THEN** the system SHALL queue `enrichment` when candidate-side work is needed
- **AND** it SHALL NOT queue `target_playlist_match_refresh` immediately for those additions alone
- **AND** the later enrichment-drain follow-on SHALL own the publish trigger

#### Scenario: Non-target playlist-only changes do not queue refresh work
- **WHEN** sync detects changes only in playlists that are not currently targets
- **THEN** the system SHALL NOT queue `target_playlist_match_refresh` for that reason alone
- **AND** it SHALL leave the current published snapshot unchanged unless another qualifying change occurred

#### Scenario: No Spotify OAuth tokens required
- **WHEN** data ingestion occurs
- **THEN** the system SHALL NOT require Spotify OAuth access tokens stored server-side
- **AND** all Spotify data flows exclusively through the extension's intercepted session tokens

## ADDED Requirements

### Requirement: Sync captures target-playlist change facts before refresh planning

The system SHALL preserve the target-playlist facts needed for refresh planning before destructive playlist writes remove that information from the database.

#### Scenario: Target playlist removal is detected before delete
- **WHEN** sync determines that a playlist has been removed from Spotify
- **THEN** it SHALL record whether that playlist was part of the current target set before deleting the playlist row
- **AND** it SHALL use that fact when deciding whether to queue `target_playlist_match_refresh`

#### Scenario: Target playlist track changes are classified from current target membership
- **WHEN** playlist-track sync changes membership for one or more playlists
- **THEN** sync planning SHALL determine whether the changed playlist IDs intersect the current target set
- **AND** it SHALL request target-playlist-song enrichment only for target-side changes

#### Scenario: Metadata-only target changes queue refresh without target-song enrichment
- **WHEN** sync detects only name or description changes on current target playlists
- **THEN** it SHALL queue `target_playlist_match_refresh`
- **AND** the refresh plan SHALL set `shouldEnrichTargetPlaylistSongs = false`

#### Scenario: Target removal with remaining targets queues refresh without target-song enrichment
- **WHEN** sync detects that a current target playlist was removed or toggled off and one or more target playlists still remain
- **THEN** it SHALL queue `target_playlist_match_refresh`
- **AND** the refresh plan SHALL set `shouldEnrichTargetPlaylistSongs = false`

#### Scenario: All target playlists removed queue empty-snapshot refresh
- **WHEN** sync detects that the current target playlist set became empty
- **THEN** it SHALL queue `target_playlist_match_refresh`
- **AND** the refresh plan SHALL set `shouldEnrichTargetPlaylistSongs = false`
- **AND** the refresh workflow SHALL be responsible for publishing the explicit empty snapshot

#### Scenario: Incomplete track sync does not create a false refresh plan
- **WHEN** playlist-track sync cannot confidently classify whether target playlists changed
- **THEN** the planner SHALL avoid inventing a more specific target-playlist refresh plan from incomplete facts
- **AND** it SHALL rely on current execution-time database reads to preserve correctness
