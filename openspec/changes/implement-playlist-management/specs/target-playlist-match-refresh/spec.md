## ADDED Requirements

### Requirement: `/playlists` exit flush coalesces manual refresh triggers
The system SHALL treat `/playlists` as a manual trigger source whose target-affecting changes request published-match refresh at most once per mounted route session.

#### Scenario: Multiple target-affecting actions collapse into one refresh request
- **WHEN** the user performs multiple target-affecting playlist actions during one `/playlists` session
- **THEN** the system requests at most one downstream `match_snapshot_refresh` follow-on when that session flushes
- **AND** it SHALL NOT ensure a new refresh job after each individual action while the route remains mounted

#### Scenario: Target-affecting metadata edits are included in the exit flush
- **WHEN** the user edits playlist metadata for a playlist that is in the target set at flush time or became a target during the same session
- **THEN** the session flush requests downstream `match_snapshot_refresh`
- **AND** that metadata edit is coalesced with any target-membership changes from the same session

#### Scenario: Non-target-only edits do not request refresh
- **WHEN** the user leaves `/playlists` after making only metadata edits to playlists that are not in the target set at flush time
- **THEN** the session flush does not request downstream `match_snapshot_refresh` for those edits alone
- **AND** the existing published snapshot remains unchanged until a qualifying trigger occurs
