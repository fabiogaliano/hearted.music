# MSR-03 — Route search and query-key contracts

## Goal

Add testable contracts for URL-backed match mode and orientation-scoped query keys before server/UI branches split.

## Depends on / blocks

Depends on:

- MSR-01

Blocks:

- MSR-20
- MSR-29
- MSR-30
- MSR-31

## Scope and out of scope

In scope:

- Add `MatchViewMode = 'song' | 'playlist'` for UI/route mode if not already present.
- Add `MatchSearch`, `validateMatchSearch`, `modeFromSearch`, and `hasNonCanonicalMatchMode` in a route-appropriate module or testable helper.
- Update or introduce match review query-key factories with orientation-scoped review/summary keys and item-id-only item keys.
- Add focused tests for search parsing/canonicalization and query-key shapes.

Out of scope:

- Route redirects/navigation wiring.
- Preference persistence.
- Server function implementation changes.

## Likely touchpoints

- `src/routes/_authenticated/match.tsx` or route helper module
- `src/features/matching/queries.ts`
- `src/features/matching/types.ts`
- Tests near the route/query helper

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` A1, A2, A3, B2, E13, E14.
- `/match` is canonical song mode; `/match?mode=playlist` is playlist mode.
- `mode=song` and invalid values normalize away later with `replace: true`.

## Acceptance criteria

- Search parser accepts only playlist mode in returned search shape.
- Helper can identify non-canonical `mode=song` and invalid `mode` values.
- Review and summary query keys include orientation; item keys remain item-id-only.
- No route loader behavior changes are required yet.

## Notes on risks or ambiguity

- If route helpers must live inside the route file, keep them exportable/testable without creating a barrel.
