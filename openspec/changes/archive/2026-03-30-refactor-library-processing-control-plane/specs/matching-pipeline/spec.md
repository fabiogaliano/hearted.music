## MODIFIED Requirements

### Requirement: Batch Selection Considers Per-User Processing

The enrichment pipeline batch selector SHALL use DB-side full-pipeline and data-enrichment selectors to choose liked songs based on missing shared enrichment artifacts and per-account pipeline processing state only, without giant app-side exclusion lists or snapshot responsibilities.

#### Scenario: Full-pipeline selector returns songs missing shared artifacts
- **WHEN** a liked song is missing any of the 4 shared data artifacts (audio features, genres, analysis, embedding)
- **THEN** the full-pipeline selector SHALL return that song for pipeline processing regardless of `item_status`
- **AND** selection SHALL happen in the database rather than by loading all processed IDs into application memory first

#### Scenario: Full-pipeline selector returns songs missing per-account pipeline completion only
- **WHEN** a liked song already has all 4 shared data artifacts
- **AND** the song has no `item_status` row for the account
- **THEN** the full-pipeline selector SHALL still return that song so the pipeline can record account-scoped processing completion
- **AND** shared enrichment stages MAY skip for that song because the artifacts already exist

#### Scenario: Full-pipeline selector skips fully pipeline-processed songs
- **WHEN** a liked song has all 4 shared data artifacts
- **AND** the song has an `item_status` row for the account
- **THEN** the full-pipeline selector SHALL NOT return that song for pipeline processing
- **AND** the selector SHALL not treat missing snapshot publication as pipeline-owned work

#### Scenario: Data-enrichment selector preserves refresh candidate semantics
- **WHEN** target-playlist refresh loads current liked-song candidates
- **THEN** the data-enrichment selector SHALL return liked songs that satisfy the 4 shared data-artifact requirements
- **AND** it SHALL NOT require account-scoped `item_status` for that refresh candidate set

#### Scenario: Selector execution avoids giant app-side exclusion lists
- **WHEN** the system selects the next liked songs needing enrichment or refresh eligibility
- **THEN** it SHALL use SQL, RPCs, or equivalent DB-native filtering to select those songs directly
- **AND** it SHALL NOT construct giant application-side `.not("song_id", "in", ...)` exclusion lists from already-processed IDs

#### Scenario: Terminal failures are filtered without app-side UUID lists
- **WHEN** liked songs have terminal enrichment failures recorded for the account
- **THEN** the full-pipeline selector SHALL exclude those songs through DB-side filtering or an equivalent DB-native join
- **AND** it SHALL avoid reintroducing large app-side exclusion lists for that failure state

#### Scenario: Queue chaining ignores snapshot publication state
- **WHEN** the pipeline determines whether more liked-song work remains for the account
- **THEN** the `hasMoreSongs` probe SHALL use the same full-pipeline selector semantics for remaining candidate-side work
- **AND** it SHALL NOT infer more work from missing `match_context`, missing `match_result`, or unpublished refresh state
