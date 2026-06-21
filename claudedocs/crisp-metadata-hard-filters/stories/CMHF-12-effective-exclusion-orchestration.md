# CMHF-12 — Effective exclusion set orchestration

## Goal

Wire hard-filter exclusions into match snapshot refresh by unioning them with existing exclusions before scoring and snapshot writing.

## Depends on / blocks

- Depends on: CMHF-11.
- Blocks: end-to-end matching enforcement for saved hard filters.

## Scope

In scope:

- Update `executeMatchSnapshotRefresh` to keep `baseExclusionSet`, `filterExclusions`, and `effectiveExclusionSet` distinct.
- If base exclusion loading fails, log and use an empty base set while still applying filter exclusions.
- If filter metadata loading fails, log and continue with base exclusions only.
- Pass `effectiveExclusionSet` to `matchBatch(...)`.
- Pass the same `effectiveExclusionSet` to `writeMatchSnapshot(...)` so `exclusionSetHash` reflects filters.
- Log `MatchFiltersExclusionSummary` counts internally.
- Add tests/integration coverage for degraded paths and snapshot hash participation.

Out of scope:

- Changing scorer semantics.
- Modifying the account-global candidate RPC.
- UI feedback for excluded counts.

## Likely touchpoints

- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`
- `src/lib/workflows/match-snapshot-refresh/write-match-snapshot.ts`
- `src/lib/domains/taste/song-matching/cache.ts` tests if needed.
- `src/lib/domains/taste/song-matching/service.ts` only for exclusion behavior tests, not scoring changes.
- Match-refresh tests.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` section 8.

- Do not modify `getEntitledDataEnrichedSongIds(accountId)` for playlist-specific filters.
- Filter exclusions are pair-specific and use the same composite key seam as existing exclusions.
- `effectiveExclusionSet` must be used for both scoring and snapshot metadata hashing.
- Filter metadata load failure is degraded, not fatal.
- Existing soft profile path for `matchIntent` and `genrePills` remains unchanged.

## Acceptance criteria

- Matching receives an exclusion set that includes both base and filter exclusions.
- Snapshot writing receives the same effective set.
- If base exclusions fail to load, filter exclusions still apply.
- If filter metadata fails to load, refresh continues with base exclusions only.
- Logs include diagnostic summary counts without user-facing output.
- A filter-only change can alter `exclusionSetHash` through `computeMatchSnapshotMetadata`.
- Relevant `bun run test` coverage passes.

## Notes on risks or ambiguity

- Current orchestrator stores one optional `exclusionSet`; ensure empty-set vs undefined behavior is intentional.
- Empty candidate and empty playlist early-return paths should remain correct.
