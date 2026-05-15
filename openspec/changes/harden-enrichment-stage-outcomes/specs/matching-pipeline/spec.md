## ADDED Requirements

### Requirement: Candidate visibility depends on accounted content activation

The system SHALL treat content activation as the account-visible completion step for enriched songs, and SHALL only mark songs visible/new after activation persistence succeeds.

#### Scenario: Account-visible status follows activation success
- **WHEN** a song has the required shared enrichment artifacts and the content activation stage persists account-visible state
- **THEN** the song MAY become visible as new or analyzed for that account
- **AND** the activation success SHALL be attributable to the parent enrichment job's stage outcome

#### Scenario: Activation failure keeps candidates retryable
- **WHEN** a song has shared enrichment artifacts but content activation fails for that account
- **THEN** the song SHALL remain eligible for later content activation after suppression expires
- **AND** it SHALL NOT be treated as permanently failed solely because account-visible activation failed

### Requirement: Missing enrichment prerequisites remain distinct from failed activation

The matching pipeline SHALL continue to exclude songs missing shared enrichment prerequisites from match snapshot candidate loading, while content activation failures remain account-visibility failures.

#### Scenario: Missing shared artifacts exclude from matching candidate set
- **WHEN** a liked song is missing analysis, embedding, or genre prerequisites required by the candidate selector
- **THEN** match snapshot refresh SHALL exclude that song from the current candidate set
- **AND** enrichment stages SHALL remain responsible for producing those artifacts

#### Scenario: Activation failure does not imply missing shared artifacts
- **WHEN** a liked song has shared enrichment artifacts but lacks account-visible item status because content activation failed
- **THEN** the system SHALL record a content activation failure
- **AND** it SHALL NOT classify the shared enrichment artifacts as missing or corrupt
