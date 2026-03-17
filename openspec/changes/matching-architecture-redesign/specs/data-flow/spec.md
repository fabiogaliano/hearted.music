## MODIFIED Requirements

### Requirement: Server Functions for Mutations

The system SHALL use TanStack Start server functions for data mutations. Matching actions SHALL write to `match_decision`, not `item_status`.

#### Scenario: Server function definition
- **WHEN** creating a server mutation
- **THEN** use `createServerFn()` with Zod validation

#### Scenario: Type safety
- **WHEN** calling server functions
- **THEN** input and output types are inferred

#### Scenario: Error handling
- **WHEN** server function fails
- **THEN** error is typed and catchable

#### Scenario: addSongToPlaylist writes match_decision
- **WHEN** user adds song to a specific playlist
- **THEN** `addSongToPlaylist` server function SHALL insert `match_decision(song_id, playlist_id, 'added')`
- **AND** SHALL NOT write to `item_status.action_type`

#### Scenario: dismissSong batch-declines
- **WHEN** user dismisses a song with suggestions for playlists A, B, C
- **THEN** `dismissSong` server function SHALL batch insert `match_decision(decision='dismissed')` for each shown playlist
- **AND** accept an array of playlist IDs as input

#### Scenario: next has no server function
- **WHEN** user clicks Next Song
- **THEN** no server function is called
- **AND** navigation state is managed in client-side UI state only

### Requirement: Optimistic Updates

The system SHALL provide optimistic updates for user actions.

#### Scenario: Add to playlist
- **WHEN** user adds song to playlist
- **THEN** immediately show playlist as "added" in the matches list (before server confirms)

#### Scenario: Dismiss song
- **WHEN** user dismisses a song
- **THEN** immediately remove all suggestions from the list and advance (before server confirms)

#### Scenario: Rollback on error
- **WHEN** mutation fails
- **THEN** revert optimistic update and show error toast

## REMOVED Requirements

### Requirement: updateStatus server function pattern
**Reason**: The `updateStatus(accountId, songId, 'added_to_playlist')` pattern is replaced by `match_decision` inserts. Matching actions no longer write to `item_status.action_type`.
**Migration**: Replace all `updateStatus` calls in matching-related server functions with `match_decision` inserts. Non-matching uses of `item_status` (newness tracking for synced items) remain unchanged.
