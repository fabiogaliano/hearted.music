## MODIFIED Requirements

### Requirement: Playlist Flagging Step

The system SHALL allow users to save target playlist selection without treating library-processing follow-on work as part of the save barrier.

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
- **AND** the save response SHALL NOT wait for library-processing follow-on work to finish

#### Scenario: Empty initial target selection skips immediate library-processing work
- **WHEN** the saved initial onboarding selection contains zero target playlists
- **THEN** the system SHALL return success for the save
- **AND** it SHALL NOT emit a library-processing change for that initial empty selection

#### Scenario: Initial target selection emits onboarding library-processing change
- **WHEN** one or more target playlists are saved during onboarding
- **THEN** the source boundary SHALL emit `onboarding_target_selection_confirmed`
- **AND** follow-on scheduling SHALL be delegated to `applyLibraryProcessingChange(...)` rather than direct trigger helpers

#### Scenario: Target selection with zero liked songs still refreshes published state
- **WHEN** one or more target playlists are saved and the account has zero data-enriched liked-song candidates
- **THEN** the system SHALL return success for the save
- **AND** library-processing SHALL still ensure `match_snapshot_refresh` follow-on work so the published snapshot reflects the current empty candidate set

#### Scenario: Valid selection may ensure enrichment without rolling back the save
- **WHEN** one or more target playlists are saved and liked-song candidate-side work is still owed
- **THEN** library-processing SHALL ensure the needed `match_snapshot_refresh` and `enrichment` follow-on work
- **AND** failure in that follow-on work SHALL NOT roll back the successful save
