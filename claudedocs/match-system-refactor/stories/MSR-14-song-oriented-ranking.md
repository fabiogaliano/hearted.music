# MSR-14 — Song-oriented suggestion-list ranking

## Goal

Implement song-mode ranking where each song query ranks playlist suggestions using orientation-specific instructions and fallbacks.

## Depends on / blocks

Depends on:

- MSR-05
- MSR-12
- MSR-13

Blocks:

- MSR-15
- MSR-17
- MSR-22

## Scope and out of scope

In scope:

- Implement `rankSongSuggestionLists`.
- Group stored matches by song.
- Use song documents as queries and playlist documents as candidates.
- Pass song orientation instruction per reranker call.
- Assign dense ranks and row-level `source`, `orderingScore`, `rerankerScore`, `documentMode`.
- Add fallback ordering by `fusedScore desc, playlistId asc`.
- Add unit tests for reranked, fallback, partial rerank tail, and metadata-only cases.

Out of scope:

- Playlist-oriented ranking.
- Snapshot publish wiring.
- UI read paths.

## Likely touchpoints

- `src/lib/workflows/enrichment-pipeline/match-ranking.ts`
- Tests under enrichment-pipeline

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` E1, E2, B6, B7, B8, I3.
- `orderingScore` is exact sort score; `rerankerScore` is raw provider score or null.
- Rows without raw provider score use `fused_fallback`.

## Acceptance criteria

- Song suggestion lists rank playlists per song with dense ranks.
- Fallback ranks are deterministic by fused score and playlist id.
- Partial rerank tails are marked `fused_fallback`.
- No strictness/display code reads `orderingScore`.

## Notes on risks or ambiguity

- Be careful not to mutate input match maps; ranking should be deterministic for tests.
