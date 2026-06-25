# MSR-36 — Read-time filter hash and visible-list predicates

## Goal

Apply safe metadata hard filters in visible-list derivation and include them in queue visibility idempotency.

## Depends on / blocks

Depends on:

- MSR-19
- MSR-22
- MSR-35

Blocks:

- MSR-37

## Scope and out of scope

In scope:

- Implement `QueueVisibilityConfigHashInput` with read-time filter hash.
- Stable-stringify target playlist read-time filters by playlist id.
- Apply language, vocal gender, release-year, and liked-at predicates in `visible-suggestion-list.ts`.
- Evaluate suggestion playlist filters against review song in song mode and review playlist filters against suggestion songs in playlist mode.
- Compute `nowMs` once per helper call.
- Add tests for AND across types, OR within languages, missing metadata failures, and liked-date boundaries.

Out of scope:

- Changing scoring/profile filters like intent/genre.
- Adding a broad candidate table.
- UI filter editor work.

## Likely touchpoints

- `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts`
- `src/lib/domains/taste/match-filters/**` if existing helpers are reused
- `src/lib/domains/taste/match-review-queue/service.ts`
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` C9, A6, A7.
- Safe hard filters are read-time; scoring/profile inputs still recompute snapshots.
- Subject-level unique indexes prevent duplicates when new hashes reveal only already-queued subjects.

## Acceptance criteria

- Visibility hash changes when read-time filter settings change.
- Loosened filters can reapply the same snapshot under a new hash.
- Visible suggestions obey documented filter semantics in both orientations.
- Captured existing cards remain stable.

## Notes on risks or ambiguity

- Candidate retention may be insufficient for some loosened filters; measure before proposing new storage.
