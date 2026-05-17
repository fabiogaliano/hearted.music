## MODIFIED Requirements

### Requirement: Matching actions persist decisions separately from newness

The system SHALL use TanStack Start server functions for matching data mutations. Matching actions SHALL write to `match_decision`, not `account_item_newness`.

#### Scenario: Matching action avoids account item newness action columns
- **WHEN** a user adds, dismisses, or skips a suggested match
- **THEN** the server function SHALL persist the user decision in `match_decision` when a decision is required
- **AND** it SHALL NOT write action state to `account_item_newness`
