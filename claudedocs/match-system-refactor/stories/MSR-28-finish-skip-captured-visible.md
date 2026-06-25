# MSR-28 — Finish and skip from captured visible pairs

## Goal

Resolve queue items on finish/skip while logging skipped events from captured visible rows with stable ranks.

## Depends on / blocks

Depends on:

- MSR-24
- MSR-26
- MSR-27

Blocks:

- MSR-31
- MSR-34

## Scope and out of scope

In scope:

- Implement `finish_match_review_item_atomic(p_item_id, p_account_id)` against captured rows.
- If uncaptured, treat set as empty and write no events per plan.
- Append skipped events for captured pairs without added decisions for the same queue item.
- Resolve as `added` when one or more adds exist, otherwise `skipped`.
- Handle unavailable/empty captured cards without event rows.
- Add tests for no capture, empty capture, one add then finish, both orientations, and already resolved.

Out of scope:

- UI navigation behavior beyond calling the updated server function.
- Dismiss decisions.

## Likely touchpoints

- `supabase/migrations/**finish_match_review_item_atomic**`
- `src/lib/server/match-review-queue.functions.ts`
- `src/lib/domains/taste/match-review-queue/queries.ts`
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` D8, H2, H4.
- Skip/finish logs events, not skipped decisions.
- All queue action event rank fields come from captured rows.

## Acceptance criteria

- Finish after add returns/completes as added and logs skipped events only for non-added captured pairs.
- Finish with no adds resolves skipped.
- No captured rows produce no event rows.
- Visible ranks remain stable after adds.

## Notes on risks or ambiguity

- Make sure added-decision lookup is scoped to the queue item to avoid suppressing events from prior sessions incorrectly.
