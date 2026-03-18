## MODIFIED Requirements

### Requirement: Split View (MVP)

The system SHALL provide a split-panel matching interface with per-playlist actions.

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
- **THEN** insert `match_decision(song_id, playlist_id=A, decision='added')`
- **AND** visually mark playlist A as added
- **AND** do NOT advance to next song (multi-add support)

#### Scenario: Dismiss action
- **WHEN** user clicks Dismiss on the song
- **THEN** batch insert `match_decision(decision='dismissed')` for all currently shown playlists
- **AND** advance to next song

#### Scenario: Next action
- **WHEN** user clicks Next Song
- **THEN** do NOT write any `match_decision`
- **AND** advance to next song
- **AND** the song SHALL reappear on the next visit to the matching page

### Requirement: Multi-add support

The system SHALL allow a song to be added to more than one playlist before advancing.

#### Scenario: Multiple additions per song
- **WHEN** user clicks Add on a playlist match
- **THEN** song is added to that playlist without advancing to the next song
- **AND** `match_decision(decision='added')` is inserted for that specific playlist

#### Scenario: Explicit advancement
- **WHEN** user has added to at least one playlist
- **THEN** a "Next Song" button SHALL be available to advance

#### Scenario: Dismiss option
- **WHEN** user does not want to add a song to any playlist
- **THEN** a "Dismiss" button SHALL batch-insert `match_decision(decision='dismissed')` for all shown playlists
- **AND** advance to the next song

## ADDED Requirements

### Requirement: Matching Page Data Source

The matching page SHALL derive its song queue from `match_result` for the latest `match_context`.

#### Scenario: Songs to review
- **WHEN** loading the matching page
- **THEN** query songs that have `match_result` rows in the latest `match_context`
- **AND** order new songs first (`item_status.is_new DESC`)
- **AND** within each group, order by best match score descending (highest score among all suggestions for that song)

#### Scenario: Playlist suggestions per song
- **WHEN** showing suggestions for a song
- **THEN** show all `match_result` rows for that song in the latest context
- **AND** ordered by match score descending

#### Scenario: Empty state
- **WHEN** no songs have `match_result` rows in the latest context
- **THEN** show an empty state ("No songs to match" or similar)

### Requirement: Songs Already in Playlist Not Suggested

The system SHALL NOT suggest adding a song to a playlist it is already in.

#### Scenario: Song exists in playlist on Spotify
- **WHEN** `playlist_song` shows song X is already in playlist A
- **THEN** do NOT show playlist A as a suggestion for song X
- **AND** no `match_result` row SHALL exist for this pair (excluded at match time)
