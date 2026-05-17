## MODIFIED Requirements

### Requirement: Cache-First Matching

The system SHALL use cache-first context hashing to avoid redundant computation and to deduplicate refresh-owned snapshot publication.

#### Scenario: No ready candidates
- **WHEN** there are no current data-enriched liked-song candidates ready for matching
- **THEN** the refresh workflow SHALL publish a snapshot with zero matches for the current target playlist set
- **AND** it SHALL NOT use `account_item_newness` as a proxy for published matching currency

### Requirement: Pipeline Writes Account Item Newness

The enrichment pipeline orchestrator SHALL write `account_item_newness` for batch songs only to record account-scoped candidate-side newness/visibility state, not published matching currency.

#### Scenario: All completed batch songs get account item newness
- **WHEN** a batch song completes candidate-side pipeline processing
- **THEN** the orchestrator SHALL create or update `account_item_newness` for that song
- **AND** the row existence SHALL continue to reflect candidate-side visibility state rather than snapshot ownership

#### Scenario: No target playlists does not block account item newness
- **WHEN** enrichment completes for a song and the account has no target playlists
- **THEN** the orchestrator SHALL still write `account_item_newness` for completed batch songs

#### Scenario: Full-pipeline selector does not rely only on account item newness
- **WHEN** a song is missing required enrichment artifacts
- **THEN** the full-pipeline selector SHALL return that song for pipeline processing regardless of `account_item_newness`

#### Scenario: Refresh candidates do not require account item newness
- **WHEN** the refresh workflow selects data-enriched liked-song candidates
- **THEN** it SHALL NOT require account-scoped `account_item_newness` for that refresh candidate set
