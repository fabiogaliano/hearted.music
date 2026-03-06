## ADDED Requirements

### Requirement: Session progress indicator
The system SHALL show users where they are in the matching queue at all times.

#### Scenario: Progress displayed
- **WHEN** user is in a matching session
- **THEN** show a count of current position vs total songs (e.g., "3 of 47")

#### Scenario: Progress bar shown
- **WHEN** user is in a matching session
- **THEN** show a visual progress bar reflecting songs reviewed / total songs

---

### Requirement: Multi-add support
The system SHALL allow a song to be added to more than one playlist before advancing.

#### Scenario: Multiple additions per song
- **WHEN** user clicks Add on a playlist match
- **THEN** song is added to that playlist without advancing to the next song

#### Scenario: Explicit advancement
- **WHEN** user has added to at least one playlist
- **THEN** a "Next Song" button SHALL be available to advance

#### Scenario: Discard option
- **WHEN** user does not want to add a song to any playlist
- **THEN** a "Discard" button SHALL advance to the next song without adding

---

### Requirement: Song analysis details panel
The system SHALL provide an expandable panel showing AI-generated song analysis.

#### Scenario: Panel collapsed by default
- **WHEN** a new song is presented
- **THEN** the details panel is collapsed

#### Scenario: Panel expands on request
- **WHEN** user activates the "Explore" control
- **THEN** the details panel expands to show key lines, themes, and emotional journey

#### Scenario: Panel collapses on dismiss
- **WHEN** user dismisses the details panel
- **THEN** it collapses and the song view returns to focus

#### Scenario: Emotional journey interactive
- **WHEN** user hovers over a journey step in the details panel
- **THEN** that step is highlighted

---

### Requirement: Session completion screen
The system SHALL show a summary screen when all songs in the queue have been reviewed.

#### Scenario: Completion triggered
- **WHEN** user advances past the last song
- **THEN** the session view is replaced by a completion screen

#### Scenario: Stats displayed
- **WHEN** completion screen is shown
- **THEN** show: total songs reviewed, songs matched (added to at least one playlist), total playlist additions, songs skipped

#### Scenario: Exit after completion
- **WHEN** user is on the completion screen
- **THEN** an exit control navigates away from the match route
