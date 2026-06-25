# MSR-15 — Playlist-oriented and combined suggestion-list ranking

## Goal

Add playlist-mode ranking and the public combined `rankMatchSuggestionLists` entrypoint for both orientations.

## Depends on / blocks

Depends on:

- MSR-14

Blocks:

- MSR-16
- MSR-17
- MSR-22
- MSR-24

## Scope and out of scope

In scope:

- Implement `rankPlaylistSuggestionLists`.
- Implement `rankMatchSuggestionLists({ orientations })` and `MATCH_RANKING_ORIENTATIONS = ['song', 'playlist']`.
- Use playlist documents as queries and song documents as candidates for playlist orientation.
- Fallback order by `fusedScore desc, songId asc`.
- Add superseded checkpoint support inside ranking between suggestion lists.
- Add combined ranking tests.

Out of scope:

- Publishing ranking rows.
- Feature/env gating; plan says no initial flag.
- Adaptive/cost-based ranking policy.

## Likely touchpoints

- `src/lib/workflows/enrichment-pipeline/match-ranking.ts`
- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts` for checkpoint integration
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` G1, G5, G6, E17.
- Compute both orientations in the initial refactor.
- Use `playlist` instruction for playlist orientation.

## Acceptance criteria

- Combined entrypoint returns ranked pairs for requested orientations.
- Playlist-mode ranks songs per playlist with dense ranks.
- Ranking can stop between suggestion lists when the job is superseded.
- No env/feature flag is introduced.

## Notes on risks or ambiguity

- Ranking both orientations may increase cost; rely on MSR-09/MSR-11 rather than adding an unplanned gate.
