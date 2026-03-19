## MODIFIED Requirements

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

#### Scenario: Stats RPC returns new_suggestions
- **WHEN** calling `get_liked_songs_stats`
- **THEN** the return type SHALL include a `new_suggestions` column
- **AND** `new_suggestions` SHALL count songs with undecided `match_result` rows AND `item_status.is_new = true`

#### Scenario: Playlists badge
- **WHEN** rendering sidebar navigation
- **THEN** show badge with count of new playlists (optional)

### Requirement: Action-Based Clearing

The system SHALL clear "new" status via session-based batch `markSeen` when the user leaves the matching page, decoupled from individual actions. User decisions are recorded in `match_decision`, not `item_status`.

#### Scenario: Add to playlist
- **WHEN** user adds song to a specific playlist
- **THEN** insert `match_decision(song_id, playlist_id, 'added')`
- **AND** `is_new` is NOT cleared immediately — clearing happens on session end

#### Scenario: Dismiss song
- **WHEN** user dismisses a song
- **THEN** batch insert `match_decision(decision='dismissed')` for all currently shown playlists
- **AND** `is_new` is NOT cleared immediately — clearing happens on session end

#### Scenario: Skip song
- **WHEN** user skips a song
- **THEN** do NOT write any `match_decision`
- **AND** `is_new` clearing happens on session end alongside all other presented songs
- **AND** the song reappears on next visit to the matching page (no decision persisted)

#### Scenario: Session end clears all presented songs
- **WHEN** user leaves the matching page (navigation, unmount, tab close)
- **THEN** batch `markSeen(accountId, "song", [...presentedSongIds])` for all songs shown during the session
- **AND** this clears `is_new` for add, dismiss, and skip actions uniformly

#### Scenario: User opens matching page without interacting
- **WHEN** user opens the matching page but leaves before any song is presented
- **THEN** do NOT clear `is_new` (presented songs set is empty)
