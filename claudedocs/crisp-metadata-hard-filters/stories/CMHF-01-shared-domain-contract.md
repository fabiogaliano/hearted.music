# CMHF-01 — Shared match-filters domain contract

## Goal

Create the shared TypeScript contract for `PlaylistMatchFiltersV1` so UI, server, matching, detector, and backfill branches use one saved shape and one interpretation.

## Depends on / blocks

- Depends on: source docs in `claudedocs/crisp-metadata-hard-filters/`.
- Blocks: every later story, especially CMHF-02, CMHF-03, CMHF-07, CMHF-08, CMHF-10, and CMHF-16.

## Scope

In scope:

- Add `src/lib/domains/taste/match-filters/` without barrel exports.
- Define `PlaylistMatchFiltersV1`, `ReleaseYearFilterV1`, `LikedAtFilterV1`, language option types, option DTOs, and diagnostic filter-type types.
- Add strict save parser and forgiving read parser.
- Add normalization helpers for inactive filters, language dedupe preserving selected order, year/date ranges, and default `{ version: 1 }`.
- Add display/chip label helpers that derive labels from normalized values.
- Add predicate helpers for language, release year, liked date, and vocals.
- Add comprehensive checked-in language catalog with lookup/search/order helpers.
- Add domain tests for parsing, normalization, labels, predicates, language lookup/search/order, and UTC date boundaries.

Out of scope:

- Database migration and generated DB types.
- Server functions.
- Production UI wiring.
- Match-refresh orchestration.
- Vocals keyword detection.

## Likely touchpoints

- `src/lib/domains/taste/match-filters/*`
- New tests under `src/lib/domains/taste/match-filters/__tests__/` or existing test convention nearby.
- Existing fixtures only if TypeScript imports require explicit DTO coverage.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 1, 3, 4, 5, 6, 7, 8, and 10.

- Root default is `{ version: 1 }`.
- Save-time validation rejects unknown keys.
- Read-time parsing ignores unknown stored keys, but invalid known-field data invalidates the whole object.
- Missing metadata fails active hard filters.
- Filters are AND across types, OR within selected languages.
- `languages.codes` preserves first-selection order after dedupe.
- Display labels are never stored.
- `likedAt` date-only comparisons use UTC half-open timestamp ranges.
- `vocalGender` accepts only `female` or `male`; `mixed`, `unknown`, and null fail exact filters.

## Acceptance criteria

- Domain module exports named symbols directly from concrete files; no barrel export is added.
- `{ version: 1 }` parses and normalizes as the no-filter value.
- Empty language arrays normalize away.
- Unknown write payload keys fail validation.
- Unknown stored keys are ignored unless a known field is invalid.
- Invalid known stored fields normalize the whole object to `{ version: 1 }` through the read parser.
- Predicate tests cover strict language OR, cross-filter AND, missing metadata exclusion, inclusive release-year boundaries, UTC liked-date boundaries, and exact vocals.
- Language helper tests cover catalog lookup, search by code/label/alias, detected-first ordering, and uncataloged-code rejection.
- Relevant `bun run test` coverage passes.

## Notes on risks or ambiguity

- The language catalog is broad and may be tedious; keep it checked in and deterministic.
- Be explicit about parser names so callers cannot accidentally use forgiving read parsing for writes.
- Avoid unsafe assertions; model parse results as typed success/failure values where practical.
