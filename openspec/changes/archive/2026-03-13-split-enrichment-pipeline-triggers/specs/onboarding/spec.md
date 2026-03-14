## MODIFIED Requirements

### Requirement: Playlist Flagging Step

The system SHALL allow users to save destination playlist selection without treating destination-side enrichment completion as part of the save barrier.

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
- **WHEN** destination playlist selection is saved successfully
- **THEN** onboarding progression MAY advance to `ready` immediately
- **AND** the save response SHALL NOT wait for destination profiling or matching to finish

#### Scenario: Empty destination selection skips follow-on work
- **WHEN** the saved selection contains zero destination playlists
- **THEN** the system SHALL return success for the save
- **AND** it SHALL NOT trigger destination profiling or matching

#### Scenario: Zero liked songs skips follow-on work
- **WHEN** destination playlists are saved but the account has zero liked songs to match
- **THEN** the system SHALL return success for the save
- **AND** it SHALL NOT trigger destination profiling or matching

#### Scenario: Valid selection triggers destination-side follow-on work
- **WHEN** one or more destination playlists are saved and liked-song candidates exist
- **THEN** the system SHALL trigger destination profiling followed by matching as follow-on work
- **AND** failure in that follow-on work SHALL NOT roll back the successful save
