## MODIFIED Requirements

### Requirement: Match decisions derive actionable suggestions from latest results

The system SHALL derive actionable suggestions from `match_result` for the latest match snapshot/result set and use `account_item_newness` only for new/seen ordering or counts.

#### Scenario: New suggestions count uses account item newness
- **WHEN** counting new actionable suggestions for an account
- **THEN** count distinct `song_id` values in `match_result` for the latest result set
- **AND** filter to songs where `account_item_newness.is_new = true`

#### Scenario: Matching session orders new songs first
- **WHEN** loading a matching session
- **THEN** query `match_result` for the latest result set
- **AND** order new songs first (`account_item_newness.is_new DESC`), then by score descending
