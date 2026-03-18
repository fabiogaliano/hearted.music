## MODIFIED Requirements

### Requirement: New Item Tracking

The system SHALL track when items become "new" to display badges.

#### Scenario: New songs synced
- **WHEN** new liked songs sync from Spotify
- **THEN** create `item_status` record with `is_new = true`

#### Scenario: New match suggestions generated
- **WHEN** enrichment pipeline or re-match produces `match_result` rows for songs
- **THEN** call `markItemsNew` for songs that received at least one match suggestion
- **AND** set `is_new = true` on those `item_status` records

#### Scenario: New playlists discovered
- **WHEN** new playlists sync from Spotify
- **THEN** create `item_status` record with `is_new = true`

### Requirement: Badge Counts

The system SHALL display counts of items in navigation, distinguishing total actionable from new.

#### Scenario: Sidebar "Match Songs" badge (total actionable)
- **WHEN** rendering sidebar navigation
- **THEN** show badge with count of ALL songs that have `match_result` rows in the latest `match_context` for the account
- **AND** this includes both new and previously seen/skipped songs
- **AND** query: `SELECT COUNT(DISTINCT song_id) FROM match_result WHERE context_id = (latest context)`

#### Scenario: Dashboard "new songs" count (new only)
- **WHEN** rendering the dashboard "Ready to match" widget
- **THEN** show count of songs with actionable suggestions that the user has NOT yet seen
- **AND** query: join `match_result` with `item_status` where `is_new = true` and `context_id = (latest context)`

#### Scenario: Playlists badge
- **WHEN** rendering sidebar navigation
- **THEN** show badge with count of new playlists (optional)

### Requirement: Action-Based Clearing

The system SHALL clear "new" status when user interacts with a song on the matching page. User decisions are recorded in `match_decision`, not `item_status`.

#### Scenario: Add to playlist
- **WHEN** user adds song to a specific playlist
- **THEN** insert `match_decision(song_id, playlist_id, 'added')`
- **AND** clear `is_new` on `item_status`

#### Scenario: Dismiss song
- **WHEN** user dismisses a song
- **THEN** batch insert `match_decision(decision='dismissed')` for all currently shown playlists
- **AND** clear `is_new` on `item_status`

#### Scenario: Skip song
- **WHEN** user skips a song
- **THEN** do NOT write any `match_decision`
- **AND** `is_new` is cleared via `markSeen` (viewport-based, song was on screen)
- **AND** the song reappears on next visit to the matching page (no decision persisted)

#### Scenario: User opens matching page without interacting
- **WHEN** user opens the matching page but leaves without any action
- **THEN** do NOT clear `is_new` (unless `markSeen` 2s viewport threshold was reached)

### Requirement: Matching Status Derivation

The system SHALL derive matching status from `match_result` and `match_decision` records, NOT from `item_status.action_type`.

#### Scenario: Song has actionable suggestions
- **WHEN** a song has `match_result` rows in the latest `match_context`
- **AND** at least one `match_result` has no corresponding `match_decision`
- **THEN** the song's matching status is `has_suggestions`

#### Scenario: Song fully acted upon
- **WHEN** a song has `match_result` rows in the latest `match_context`
- **AND** every `match_result` has a corresponding `match_decision`
- **THEN** the song's matching status is `acted`

#### Scenario: Song has no suggestions
- **WHEN** a song has no `match_result` rows in the latest `match_context`
- **AND** the song has an `item_status` row (pipeline processed it)
- **THEN** the song's matching status is `no_suggestions`

#### Scenario: Song is pending
- **WHEN** a song has no `item_status` row
- **THEN** the song's matching status is `pending`

#### Scenario: SQL functions use match_result for filtering
- **WHEN** `get_liked_songs_page` filters by matching status
- **THEN** it SHALL JOIN on `match_result`/`match_context`/`match_decision` to derive status

#### Scenario: SQL functions use match_result for counting
- **WHEN** `get_liked_songs_stats` counts matched and pending songs
- **THEN** it SHALL derive counts from `match_result`/`match_decision` composition

## REMOVED Requirements

### Requirement: item_status action_type and actioned_at columns
**Reason**: Matching actions move to `match_decision` table with per-(song, playlist) granularity. `item_status` becomes a pipeline processing tracker only.
**Migration**: Remove `action_type` and `actioned_at` columns from `item_status`. All matching action data moves to `match_decision`. Pre-production — no data migration needed.
