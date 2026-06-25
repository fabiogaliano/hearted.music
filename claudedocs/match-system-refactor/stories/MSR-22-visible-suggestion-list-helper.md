# MSR-22 — Visible suggestion-list derivation helper

## Goal

Create the single helper that derives the ordered visible suggestion list before presentation capture.

## Depends on / blocks

Depends on:

- MSR-04
- MSR-17
- MSR-19

Blocks:

- MSR-23
- MSR-24
- MSR-25
- MSR-27
- MSR-28
- MSR-36

## Scope and out of scope

In scope:

- Implement pair-row loading by `MatchReviewSubject` and orientation.
- Apply orientation-specific ownership/entitlement checks.
- Filter by `strictnessScore`.
- Remove decided pairs.
- Join `match_result_ranking` by orientation and sort by rank with strictness stable fallback.
- Assign dense `visibleRank` values.
- Return `VisibleSuggestionList` with `fitScore`, `modelRank`, and pair IDs.
- Add pure/helper tests for sorting/filtering/rank assignment.

Out of scope:

- Read-time hard filter predicates; add placeholders or no-op hash until MSR-36.
- Capture RPC.
- Render data mapping.

## Likely touchpoints

- `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts`
- `src/lib/domains/taste/match-review-queue/queries.ts`
- `src/lib/domains/taste/song-matching/queries.ts`
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` B4, C12, E7, F2.
- Strictness and fit score use `fused_score ?? score`.
- Inside-card order uses orientation-specific ranking; fallback is strictness score plus stable id.

## Acceptance criteria

- Song orientation returns playlist suggestions for a song subject.
- Playlist orientation returns song suggestions for a playlist subject.
- Visible ranks are dense and deterministic after filters/removals.
- Unavailable ownership/entitlement cases are represented for callers without throwing expected failures.

## Notes on risks or ambiguity

- Filter metadata may be unavailable later; model expected failures as typed results rather than success-shaped fallbacks.
