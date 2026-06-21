# CMHF-18 — Vocals backfill script

## Goal

Add an idempotent one-time maintenance script that backfills `vocalGender` filters from existing unambiguous playlist intent text.

## Depends on / blocks

- Depends on: CMHF-02, CMHF-07, and CMHF-16.
- Blocks: production release maintenance task for vocals auto-fill/backfill.

## Scope

In scope:

- Add `scripts/backfill-playlist-match-filter-vocals.ts`.
- Support dry-run mode that reports planned changes without writes or invalidation.
- Scan all playlists with non-empty `match_intent`, not target playlists only.
- Parse existing `match_filters` with shared read parser.
- Skip playlists that already have `matchFilters.vocalGender`.
- Preserve all other existing filters when writing `vocalGender`.
- Skip ambiguous, absent, and invalid filters as specified.
- Write normalized `match_filters` for unambiguous detections.
- Emit existing metadata-changed invalidation for accounts whose changed playlists include target playlists.
- Log changed, skipped-existing, skipped-ambiguous, skipped-invalid, and failed counts.
- Add tests or dry-run verification coverage.

Out of scope:

- Editor detector integration.
- Adding a feature flag.
- Running the script in production.

## Likely touchpoints

- `scripts/backfill-playlist-match-filter-vocals.ts`
- `src/lib/domains/taste/match-filters/` parser and detector modules.
- `src/lib/domains/library/playlists/queries.ts` for scan/update helpers if needed.
- `src/lib/workflows/library-processing/service.ts`
- `src/lib/workflows/library-processing/changes/playlist-management.ts`
- Script tests or documented dry-run command.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 6, 9, and 10.

- Script is idempotent.
- Skip existing `vocalGender` filters.
- Preserve other filters exactly through normalization.
- Invalid stored filters are skipped, not silently repaired by backfill.
- Dry-run writes nothing and emits no invalidation.
- Invalidation is required only for accounts whose target playlists changed.

## Acceptance criteria

- Dry-run logs planned changed/skipped counts and performs no writes.
- Write mode updates only playlists with unambiguous detection and no existing `vocalGender`.
- Existing non-vocals filters are preserved in updated rows.
- Existing `vocalGender` rows are skipped.
- Ambiguous/absent/invalid rows are skipped and counted.
- Changed target playlists cause account-level metadata-changed invalidation.
- Failures are counted/logged without hiding partial script outcome.
- Relevant `bun run test` or documented dry-run verification passes.

## Notes on risks or ambiguity

- Backfill scans all playlists, but invalidation only matters for changed target playlists.
- Use explicit CLI args for dry-run/write mode so accidental writes are hard.
