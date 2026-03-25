## MODIFIED Requirements

### Requirement: Playlist Flagging Step

The system SHALL allow users to save target playlist selection without treating target-playlist refresh completion as part of the save barrier.

#### Scenario: Selection UI displayed
- **WHEN** sync completes
- **THEN** show grid of playlists with checkboxes

#### Scenario: Minimum selection required
- **WHEN** user tries to continue
- **THEN** require at least 1 playlist selected (or allow skip)

#### Scenario: Helpful guidance
- **WHEN** user views playlist selection
- **THEN** show hint: "Pick playlists that have a clear theme or mood"

#### Scenario: Successful save advances immediately
- **WHEN** target playlist selection is saved successfully
- **THEN** onboarding progression MAY advance to `ready` immediately
- **AND** the save response SHALL NOT wait for target-playlist refresh or liked-song enrichment follow-on work to finish

#### Scenario: Empty initial target selection skips immediate follow-on work
- **WHEN** the saved selection contains zero target playlists and the account has no previously published target snapshot to clear
- **THEN** the system SHALL return success for the save
- **AND** it SHALL NOT trigger target-playlist refresh solely for that initial empty selection

#### Scenario: Target selection with zero liked songs still refreshes published state
- **WHEN** one or more target playlists are saved and the account has zero data-enriched liked-song candidates
- **THEN** the system SHALL return success for the save
- **AND** it SHALL queue target-playlist refresh follow-on work so the published snapshot reflects the current empty candidate set

#### Scenario: Valid selection triggers target-playlist follow-on work
- **WHEN** one or more target playlists are saved and liked-song candidates may contribute to matching
- **THEN** the system SHALL trigger `target_playlist_match_refresh` as follow-on work
- **AND** it MAY also request candidate-side liked-song enrichment if liked-song enrichment is incomplete
- **AND** failure in that follow-on work SHALL NOT roll back the successful save
