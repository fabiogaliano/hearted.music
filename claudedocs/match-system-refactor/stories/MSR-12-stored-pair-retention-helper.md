# MSR-12 — Stored pair retention helper

## Goal

Broaden persisted pair retention to the union of song-top-N and playlist-top-N pairs without changing pair scoring.

## Depends on / blocks

Depends on:

- MSR-02
- MSR-04

Blocks:

- MSR-14
- MSR-15
- MSR-17
- MSR-36

## Scope and out of scope

In scope:

- Add `MATCH_STORED_PAIRS_PER_SONG` and `MATCH_STORED_PAIRS_PER_PLAYLIST`.
- Implement pure `retainStoredMatchPairs` helper.
- Use `fusedScore desc` plus stable ID tie-breakers per orientation.
- Return each `(songId, playlistId)` at most once and sorted by publication grouping order.
- Add focused unit tests for union, duplicates, ties, and empty inputs.

Out of scope:

- Reranker/ranking implementation.
- Changing fusion/scoring formulas.
- Read-time hard filter movement.

## Likely touchpoints

- `src/lib/domains/taste/song-matching/service.ts`
- `src/lib/domains/taste/song-matching/types.ts` if needed
- Tests near song-matching service

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` E6, G4.
- This changes retention, not scoring.
- Initial per-playlist limit mirrors `DEFAULT_MATCHING_CONFIG.maxResultsPerSong`.

## Acceptance criteria

- Pairs in either orientation top-N are retained.
- Duplicate retained pairs collapse to one result.
- Returned rows have deterministic order.
- Existing matching behavior above the retention point remains unchanged.

## Notes on risks or ambiguity

- Increased row volume is expected; do not add a broad candidate table in this story.
