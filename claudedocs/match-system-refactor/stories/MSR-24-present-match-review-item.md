# MSR-24 — Authoritative presentMatchReviewItem server read

## Goal

Load the active card through derivation plus capture and return render-ready data from captured visible rows.

## Depends on / blocks

Depends on:

- MSR-20
- MSR-22
- MSR-23

Blocks:

- MSR-25
- MSR-26
- MSR-27
- MSR-28
- MSR-31

## Scope and out of scope

In scope:

- Add `presentMatchReviewItem({ itemId })` server function.
- Derive `VisibleSuggestionList`, call capture RPC, then join captured rows to song/playlist render data.
- Return `MatchReviewItemRead` discriminated union with `ready`, `unavailable`, and `retryable-error` statuses.
- Keep `getMatchReviewItem` side-effect-free and prefetch-only.
- Apply song-mode newness clearing only on song-mode presentation.
- Add server tests for ready, empty, unavailable, retryable, and already-captured cases.

Out of scope:

- Mutation action rewrites.
- UI component rendering.
- Read-time hard filters beyond no-op/current behavior.

## Likely touchpoints

- `src/lib/server/match-review-queue.functions.ts`
- `src/lib/domains/taste/match-review-queue/queries.ts`
- `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts`
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` D9, D10, E10, H6, H7.
- Authoritative card rendering must use `presentMatchReviewItem`, not prefetched `getMatchReviewItem` data.
- Playlist-mode presentation does not clear account item newness in this refactor.

## Acceptance criteria

- First presentation creates captured rows or empty capture.
- Retries return existing captured rows without recomputation/redensing.
- Ready response is typed by mode with review item and suggestions.
- Retryable errors do not resolve queue items.

## Notes on risks or ambiguity

- Be careful that side-effect-free prefetch data cannot accidentally be shown after capture ships.
