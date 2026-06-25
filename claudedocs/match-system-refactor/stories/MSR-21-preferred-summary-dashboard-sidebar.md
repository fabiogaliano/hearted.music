# MSR-21 — Preferred match view mode, dashboard, and sidebar summaries

## Goal

Persist last selected match mode for non-`/match` surfaces and use it for dashboard/sidebar summaries and links.

## Depends on / blocks

Depends on:

- MSR-08
- MSR-20

Blocks:

- MSR-29
- MSR-30

## Scope and out of scope

In scope:

- Add `getPreferredMatchViewMode` and `setPreferredMatchViewMode` helpers.
- Add `getPreferredMatchReviewSummary` server function delegating to explicit orientation summary.
- Update dashboard/sidebar summary fetches to use preferred summary.
- Update Match links to `/match` for song preference and `/match?mode=playlist` for playlist preference.
- Invalidate preferred summary and dashboard keys after successful preference update.

Out of scope:

- Letting preference override explicit `/match` URL.
- Header toggle UI implementation beyond calling the preference setter later.

## Likely touchpoints

- `src/lib/domains/library/accounts/preferences-queries.ts`
- `src/lib/server/match-review-queue.functions.ts`
- `src/lib/server/dashboard.functions.ts`
- `src/routes/_authenticated/-components/Sidebar.tsx`
- `src/features/matching/queries.ts`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` C10, D11, E15, A3.
- `/match` URL is source of truth on the route.
- Preference applies to dashboard/sidebar summaries and navigation links only.

## Acceptance criteria

- Preferred summary returns the orientation from `user_preferences.match_view_mode`.
- Dashboard/sidebar links reflect saved mode.
- Toggling preference invalidates preferred summary/dashboard caches when wired by UI.
- Explicit orientation summaries remain available.

## Notes on risks or ambiguity

- Preference update is best-effort from the toggle; route navigation should not wait on it.
