# MSR-16 — Ranking config hash and snapshot invalidation

## Goal

Force new immutable snapshots when ranking schema/config changes, even if candidate data did not change.

## Depends on / blocks

Depends on:

- MSR-13
- MSR-15

Blocks:

- MSR-17

## Scope and out of scope

In scope:

- Add `hashRankingConfig` with `rk_` prefix.
- Add `MATCH_RANKING_SCHEMA_VERSION = 'oriented-suggestion-lists-v1'`.
- Include orientations, stored pair limits, and rerank instructions in `rankingConfigHash`.
- Include `rankingConfigHash` in `computeMatchSnapshotMetadata` and `hashMatchSnapshot`.
- Add hash tests showing ranking config changes alter snapshot hash.

Out of scope:

- Publishing ranking rows.
- Changing unrelated matching algorithm versions.

## Likely touchpoints

- `src/lib/domains/enrichment/embeddings/hashing.ts`
- `src/lib/domains/taste/song-matching/cache.ts`
- `src/lib/workflows/match-snapshot-refresh/*metadata*` or hash callers
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` G2, G3, I4.
- Bumping `MATCHING_ALGO_VERSION` alone is not sufficient unless the hashed metadata changes.
- Instruction strings must participate in ranking config hashing.

## Acceptance criteria

- Snapshot hash changes when ranking schema version/instructions/orientations/limits change.
- Existing hash helpers remain deterministic.
- `rankingConfigHash` is visible in snapshot metadata where the plan expects it.

## Notes on risks or ambiguity

- Locate all snapshot hash construction paths before patching to avoid a partial invalidation story.
