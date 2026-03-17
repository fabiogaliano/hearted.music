## MODIFIED Requirements

### Requirement: Playlist Flagging Step

The system SHALL allow users to save destination playlist selection without treating background enrichment completion as part of the save barrier.

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
- **AND** the save response SHALL NOT wait for background enrichment to finish

#### Scenario: Empty destination selection skips follow-on work
- **WHEN** the saved selection contains zero destination playlists
- **THEN** the system SHALL return success for the save
- **AND** it SHALL NOT trigger background enrichment follow-on work from the save path

#### Scenario: Zero liked songs skips follow-on work
- **WHEN** destination playlists are saved but the account has zero liked songs to enrich or match
- **THEN** the system SHALL return success for the save
- **AND** it SHALL NOT create a new background enrichment job from the save path

#### Scenario: Valid selection creates or reuses background enrichment
- **WHEN** one or more destination playlists are saved and liked-song candidates exist
- **THEN** the system SHALL create or reuse the account's active `enrichment` background job
- **AND** it SHALL NOT create a second duplicate active chain for the same account
- **AND** any matching or profiling work needed after the save SHALL happen as part of that background enrichment chain

#### Scenario: Follow-on failure does not roll back the save
- **WHEN** background enrichment later fails after destination playlists were saved successfully
- **THEN** the saved destination playlist selection SHALL remain persisted
- **AND** the onboarding save response SHALL remain successful
