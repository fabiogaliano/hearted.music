# MSR-17 — Atomic ranking publication and legacy compatibility fields

## Goal

Publish ranking rows atomically with match results and preserve legacy `match_result.score/rank` compatibility semantics.

## Depends on / blocks

Depends on:

- MSR-05
- MSR-15
- MSR-16

Blocks:

- MSR-18
- MSR-22

## Scope and out of scope

In scope:

- Wire match snapshot refresh to call `rankMatchSuggestionLists` after retained pair computation.
- Pass nested `rankings` in each `p_results` item.
- Complete `publish_match_snapshot` insertion into `match_result_ranking` within the same transaction.
- Set legacy `match_result.score/rank` from song-orientation ordering/rank when available, with fallback semantics.
- Add publish integration tests for both orientations and legacy payloads.

Out of scope:

- Read-path migration to use ranking rows.
- UI mode launch.
- Deleting legacy columns.

## Likely touchpoints

- `src/lib/workflows/match-snapshot-refresh/write-match-snapshot.ts`
- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`
- `src/lib/domains/taste/song-matching/service.ts`
- `supabase/migrations/**publish_match_snapshot**`
- Integration tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` D1, D2, I1, I2.
- Snapshots remain atomic; no partial ranking publication.
- New read paths must use `match_result_ranking`, not legacy score/rank.

## Acceptance criteria

- New snapshots contain ranking rows for both orientations.
- Legacy publish without nested rankings still succeeds.
- Ranking row FK and unique rank constraints hold.
- `match_result.score/rank` retain planned compatibility meaning.

## Notes on risks or ambiguity

- RPC JSON validation must be strict enough to avoid bad ranking rows but tolerant of older callers.
