## MODIFIED Requirements

### Requirement: Extension as Primary Data Source

The system SHALL use the Chrome extension as the primary mechanism for ingesting Spotify data and emitting one aggregated `library_synced` change that drives durable background library-processing after sync-time change classification.

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

#### Scenario: Sync emits one aggregated library-processing change
- **WHEN** `/api/extension/sync` completes its persistence phases successfully
- **THEN** the backend SHALL call `applyLibraryProcessingChange(...)` exactly once with a backend-internal `library_synced` change for that request
- **AND** that change SHALL carry required liked-song and target-playlist booleans without timestamps or request markers

#### Scenario: All-false sync results still emit a semantic sync change
- **WHEN** a sync request completes with no processing-relevant changes
- **THEN** the backend SHALL still emit one aggregated `library_synced` change for that request
- **AND** all change booleans SHALL be `false`

#### Scenario: Liked-song additions with current targets request both workflows
- **WHEN** sync detects newly added liked songs and the account currently has one or more target playlists
- **THEN** the aggregated `library_synced` change SHALL allow library-processing to invalidate both `enrichment` and `matchSnapshotRefresh`
- **AND** follow-on work SHALL run outside the sync request lifecycle

#### Scenario: Liked-song additions without current targets request enrichment only
- **WHEN** sync detects newly added liked songs and the account currently has zero target playlists
- **THEN** the aggregated `library_synced` change SHALL allow library-processing to invalidate `enrichment`
- **AND** it SHALL not force immediate refresh invalidation for that addition alone

#### Scenario: Non-target playlist-only changes do not request follow-on work
- **WHEN** sync detects changes only in playlists that are not currently targets
- **THEN** the emitted `library_synced` change SHALL leave the processing-relevant booleans false for that reason alone
- **AND** the sync request SHALL not schedule library-processing follow-on work from those non-target changes alone

#### Scenario: No Spotify OAuth tokens required
- **WHEN** data ingestion occurs
- **THEN** the system SHALL NOT require Spotify OAuth access tokens stored server-side
- **AND** all Spotify data flows exclusively through the extension's intercepted session tokens

### Requirement: Sync captures target-playlist change facts before refresh planning

The system SHALL preserve the target-playlist facts needed to emit correct `library_synced` change booleans before destructive playlist writes remove that information from the database.

#### Scenario: Target playlist removal is detected before delete
- **WHEN** sync determines that a playlist has been removed from Spotify
- **THEN** it SHALL record whether that playlist was part of the current target set before deleting the playlist row
- **AND** it SHALL use that fact when computing `targetPlaylists.removed`

#### Scenario: Target playlist track changes are classified from current target membership
- **WHEN** playlist-track sync changes membership for one or more playlists
- **THEN** sync classification SHALL determine whether the changed playlist IDs intersect the current target set
- **AND** it SHALL use that fact when computing `targetPlaylists.trackMembershipChanged`

#### Scenario: Metadata-only target changes use profile-text booleans
- **WHEN** sync detects name or description changes on current target playlists without processing-relevant track membership changes
- **THEN** it SHALL set `targetPlaylists.profileTextChanged = true`
- **AND** it SHALL avoid broadening that fact into a less specific metadata bucket

#### Scenario: Processing-relevant target removals share one public boolean
- **WHEN** sync detects that some or all current target playlists were removed or toggled off
- **THEN** it SHALL set `targetPlaylists.removed = true`
- **AND** later reconciliation or execution-time DB reads SHALL determine whether refresh publishes remaining-target or empty-target state

#### Scenario: Incomplete track sync does not invent false target facts
- **WHEN** playlist-track sync cannot confidently classify whether target playlists changed
- **THEN** the emitted `library_synced` change SHALL avoid inventing more specific target-side booleans than the source data supports
- **AND** later execution-time DB reads SHALL preserve correctness for any follow-on refresh work
