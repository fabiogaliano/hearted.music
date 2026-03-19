## MODIFIED Requirements

### Requirement: Split View (MVP)

The system SHALL provide a split-panel matching interface with per-playlist actions. Action handlers SHALL call server functions to persist decisions.

#### Scenario: Layout structure
- **WHEN** user views Split View
- **THEN** show song panel on left, playlist matches on right

#### Scenario: Song panel content
- **WHEN** viewing current song
- **THEN** show: album art, title, artist, audio player, mood tags, genre tags

#### Scenario: Matches panel content
- **WHEN** viewing playlist matches
- **THEN** show ranked list with: playlist name, match score, match factors, Add button

#### Scenario: Add to playlist action
- **WHEN** user clicks Add on a match for playlist A
- **THEN** call `addSongToPlaylist` server function to insert `match_decision(song_id, playlist_id=A, decision='added')`
- **AND** visually mark playlist A as added
- **AND** do NOT advance to next song (multi-add support)

#### Scenario: Dismiss action
- **WHEN** user clicks Dismiss on the song
- **THEN** call `dismissSong` server function to batch insert `match_decision(decision='dismissed')` for all currently shown playlists
- **AND** advance to next song

#### Scenario: Next action
- **WHEN** user clicks Next Song
- **THEN** do NOT call any server function
- **AND** advance to next song
- **AND** the song SHALL reappear on the next visit to the matching page

### Requirement: Matching Page Data Source

The matching page SHALL load songs one at a time via `getSongMatches`, not all upfront.

#### Scenario: Initial load
- **WHEN** loading the matching page
- **THEN** call `getMatchingSession` to get the context ID and total undecided song count
- **AND** call `getSongMatches(contextId, 0)` to load the first song

#### Scenario: Playlist suggestions per song
- **WHEN** showing suggestions for a song
- **THEN** display all match results returned by `getSongMatches` for that song
- **AND** ordered by match score descending

#### Scenario: Empty state
- **WHEN** `getMatchingSession` returns `null` or `totalSongs === 0`
- **THEN** show a simple empty state message explaining no suggestions are available

### Requirement: Session completion screen

The system SHALL show a summary screen when all songs in the queue have been reviewed, with stats derived from persisted decisions.

#### Scenario: Completion triggered
- **WHEN** user advances past the last song (offset >= totalSongs)
- **THEN** the session view is replaced by a completion screen

#### Scenario: Stats displayed
- **WHEN** completion screen is shown
- **THEN** show: total songs reviewed, songs matched (added to at least one playlist), total playlist additions, songs skipped
- **AND** stats SHALL be derived from `match_decision` rows written during the session, not from local state

#### Scenario: Exit after completion
- **WHEN** user is on the completion screen
- **THEN** an exit control navigates away from the match route

## ADDED Requirements

### Requirement: Data-agnostic matching component

`Matching.tsx` SHALL accept song and playlist data via props, allowing the same display components to render mock data (landing page) or real data (authenticated `/match` route).

#### Scenario: Landing page with mock data
- **WHEN** rendering the matching demo on the landing page
- **THEN** pass hardcoded mock songs and playlists as props to `Matching.tsx`
- **AND** action handlers SHALL be local state only (no server calls)

#### Scenario: Authenticated page with real data
- **WHEN** rendering the `/match` route
- **THEN** pass real song and playlist data from `getSongMatches` as props to `Matching.tsx`
- **AND** action handlers SHALL call server functions to persist decisions

#### Scenario: Shared display components
- **WHEN** rendering in either mode (landing or authenticated)
- **THEN** the same sub-components (`MatchingSession`, `SongSection`, `MatchesSection`, `DetailsPanel`) SHALL be used
- **AND** only the data source and action callbacks differ
