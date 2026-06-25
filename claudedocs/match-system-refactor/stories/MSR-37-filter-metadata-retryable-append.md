# MSR-37 — Filter metadata retryable errors and newly visible subject append

## Goal

Harden read-time filter metadata loading so active sessions append newly visible subjects while current-card failures remain retryable.

## Depends on / blocks

Depends on:

- MSR-36

Blocks:

- MSR-38

## Scope and out of scope

In scope:

- Load account-scoped metadata needed for language, vocals, release year, and liked-at filters in visible-list derivation.
- Return retryable card errors for metadata load failures instead of resolving items.
- Ensure `syncActiveMatchReviewSessions` appends newly visible subjects under new visibility hashes.
- Invalidate affected current item queries only when the card has not already captured or when retryable load state needs refetch.
- Add integration tests for loosened filters revealing subjects and metadata load failure behavior.

Out of scope:

- New filter types.
- Changing captured rows after capture.
- Snapshot recompute changes already handled by MSR-35.

## Likely touchpoints

- `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts`
- `src/lib/server/match-review-queue.functions.ts`
- `src/lib/domains/taste/match-review-queue/service.ts`
- Playlist save invalidation hooks/tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` H7, D12.
- Retryable card-load errors render Retry and do not resolve the queue item.
- Filter changes apply to future cards/future sessions, not captured current cards.

## Acceptance criteria

- Filter metadata load failures produce `retryable-error` card reads.
- Loosening filters can append newly visible subjects from an already-applied snapshot.
- Already captured cards do not mutate after filter changes.
- Filter-only save path invalidates the right orientation-scoped caches.

## Notes on risks or ambiguity

- Distinguish no-visible-suggestions from metadata-unavailable; one can resolve/unavailable, the other must be retryable.
