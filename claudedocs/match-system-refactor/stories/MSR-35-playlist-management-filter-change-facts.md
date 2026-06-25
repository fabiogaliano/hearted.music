# MSR-35 — Playlist-management change facts and filter-only sync invalidation

## Goal

Separate scoring/profile changes from read-time filter changes so filter-only saves stop enqueueing snapshot refreshes.

## Depends on / blocks

Depends on:

- MSR-09
- MSR-20

Blocks:

- MSR-36
- MSR-37

## Scope and out of scope

In scope:

- Change playlist-management flush facts to include `targetMembershipChanged`, `scoringConfigChanged`, and `readTimeFilterChanged`.
- Update reconciler so membership/scoring changes request refresh and read-time-filter-only changes do not.
- For filter-only saves, call `syncActiveMatchReviewSessions` and invalidate orientation-scoped review/summary/current item queries.
- Keep mixed saves enqueuing one refresh.
- Add reconciler/server invalidation tests.

Out of scope:

- Actually moving predicates to read time.
- Changing intent/genre/profile recompute behavior.
- UI filter editor changes unless required by existing save pipeline.

## Likely touchpoints

- `src/lib/workflows/library-processing/types.ts`
- `src/lib/workflows/library-processing/reconciler.ts`
- Playlist management save/server functions
- `src/features/playlists/*` invalidation hooks if applicable
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` E18.
- Intent text, genre pills, and playlist membership remain refresh triggers.
- Filter-only saves sync active match review sessions instead of enqueueing refresh.

## Acceptance criteria

- Filter-only save does not create a match snapshot refresh job.
- Mixed save still enqueues refresh.
- Active sessions are synced after filter-only save.
- Captured current cards are not invalidated/mutated.

## Notes on risks or ambiguity

- Need to identify current playlist-management change plumbing before implementation; do not infer flags from UI labels alone.
