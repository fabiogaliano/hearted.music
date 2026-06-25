# MSR-29 — /match route mode normalization and bootstrap

## Goal

Make `/match` mode URL-backed and pass orientation into loader/bootstrap without rendering the final toggle yet.

## Depends on / blocks

Depends on:

- MSR-03
- MSR-20
- MSR-21
- MSR-25

Blocks:

- MSR-30
- MSR-31

## Scope and out of scope

In scope:

- Wire route search validation into `src/routes/_authenticated/match.tsx`.
- Add `beforeLoad` normalization with `replace: true` for `mode=song` and invalid mode values.
- Use loader deps to pass `modeFromSearch(search)` into queue bootstrap/prefetches.
- Do not let `match_view_mode` override explicit URL mode.
- Add route tests if existing route testing patterns support them.

Out of scope:

- Header segmented toggle UI.
- Playlist-mode component composition.
- Preference update after toggle activation.

## Likely touchpoints

- `src/routes/_authenticated/match.tsx`
- `src/features/matching/queries.ts`
- Route helper tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` A3, E13.
- `/match` is canonical song mode; `/match?mode=playlist` is canonical playlist mode.
- Navigation source of truth is the URL.

## Acceptance criteria

- `/match` loads song orientation.
- `/match?mode=playlist` loads playlist orientation.
- `/match?mode=song` and invalid mode URLs redirect/replace to `/match`.
- Loader/bootstrap query keys are orientation-scoped.

## Notes on risks or ambiguity

- TanStack route normalization must avoid push-loop behavior; use `replace: true`.
