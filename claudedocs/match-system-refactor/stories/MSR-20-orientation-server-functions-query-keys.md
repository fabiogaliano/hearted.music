# MSR-20 — Orientation-scoped server functions, sync, and query invalidation

## Goal

Expose orientation-scoped queue server functions and React Query keys so clients can request each match pass independently.

## Depends on / blocks

Depends on:

- MSR-03
- MSR-19

Blocks:

- MSR-21
- MSR-24
- MSR-29
- MSR-31

## Scope and out of scope

In scope:

- Update `startOrResumeMatchReview`, `getMatchReview`, and `getMatchReviewSummary` inputs to include orientation.
- Add `MatchOrientationSchema` validation.
- Replace singular live-update sync with `syncActiveMatchReviewSessions` returning per-orientation results.
- Update `useActiveJobs` to await plural sync and invalidate `reviewsRoot`/`summariesRoot` without invalidating item queries.
- Migrate feature query helpers to the orientation key contract.

Out of scope:

- Preferred summary delegation.
- Route mode toggle wiring.
- Visible item presentation.

## Likely touchpoints

- `src/lib/server/match-review-queue.functions.ts`
- `src/features/matching/queries.ts`
- `src/features/jobs/useActiveJobs*` or equivalent
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` D12, E13, E14.
- Item reads remain keyed by item id.
- Every queue boundary takes orientation explicitly.

## Acceptance criteria

- Server functions reject invalid orientation inputs.
- Review and summary queries for song/playlist do not collide.
- Background refresh sync handles all active orientation sessions.
- Captured item queries are not invalidated by refresh completion.

## Notes on risks or ambiguity

- Coordinate call-site updates to avoid temporarily starting only song sessions from old wrappers.
