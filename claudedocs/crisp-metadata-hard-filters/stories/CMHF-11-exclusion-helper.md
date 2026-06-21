# CMHF-11 — Match-filter exclusion helper

## Goal

Build playlist-specific hard-filter exclusions from parsed filters and loaded metadata.

## Depends on / blocks

- Depends on: CMHF-01 and CMHF-10.
- Blocks: CMHF-12.

## Scope

In scope:

- Add `loadMatchFilterExclusions(...)` or equivalent helper with the planned signature.
- Parse each playlist's `match_filters` with the shared read parser before evaluation.
- For every candidate `(song, playlist)` pair, add `${songId}:${playlistId}` when any active filter fails.
- Produce `MatchFiltersExclusionSummary` for internal diagnostics.
- Count failed checks by filter type and excluded pairs once per pair.
- Treat invalid stored filters as no filters for that playlist only and record/log parser details.
- Add tests for language OR, cross-type AND, missing metadata failures, invalid stored filters, and summary counts.

Out of scope:

- Orchestrator effective-set plumbing.
- Metadata DB loading implementation if not already done in CMHF-10.
- User-facing exclusion reasons/counts.

## Likely touchpoints

- New helper under `src/lib/workflows/match-snapshot-refresh/` or `src/lib/domains/taste/match-filters/` integration module.
- `src/lib/workflows/match-snapshot-refresh/types.ts` if summary types are shared.
- Tests near match-refresh or match-filters domain helpers.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 3, 5, and 8.

- Composite exclusion key format is `${songId}:${playlistId}`.
- Invalid stored filters disable filters only for that playlist.
- Missing metadata fails active filters.
- Hard filters are AND across types and OR within selected languages.
- `failedChecksByType` can count multiple failures per excluded pair.
- `excludedPairCount` counts each excluded pair once.

## Acceptance criteria

- Playlists with no active filters produce no filter exclusions.
- Active language filters pass on primary or secondary language and fail otherwise.
- Release-year, liked-date, and vocals predicates follow CMHF-01 exactly.
- Invalid stored filters are logged/recorded and do not crash helper execution.
- Summary shape matches the locked `MatchFiltersExclusionSummary` contract.
- Tests cover multiple failed filter types on one pair and count semantics.

## Notes on risks or ambiguity

- Keep loops efficient: precompute active filters and metadata maps, short-circuit where possible while still counting failed checks correctly.
- Do not mutate playlist filter data while parsing/evaluating.
