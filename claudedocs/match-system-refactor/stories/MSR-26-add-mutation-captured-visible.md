# MSR-26 — Add mutation from captured visible pairs

## Goal

Make queue add actions orientation-aware and validate the target suggestion against captured visible pairs.

## Depends on / blocks

Depends on:

- MSR-23
- MSR-24

Blocks:

- MSR-27
- MSR-28
- MSR-33

## Scope and out of scope

In scope:

- Update public add input to `{ itemId, suggestionId }`.
- Implement `add_match_review_item_decision_atomic` with `p_suggestion_song_id` / `p_suggestion_playlist_id` target parameters.
- Derive orientation and review item from the locked queue item.
- Require matching captured visible pair.
- Verify playlist ownership and song entitlement.
- Write `match_decision` and `match_event` with `served_orientation`, `model_rank`, and `visible_rank` from capture.
- Map DB statuses to kebab-case public reasons.
- Add server/RPC tests for song and playlist orientations.

Out of scope:

- Dismiss/finish rewrites.
- UI row components except adapting existing add calls as needed.

## Likely touchpoints

- `supabase/migrations/**add_match_review_item_decision_atomic**`
- `src/lib/server/match-review-queue.functions.ts`
- `src/lib/domains/taste/match-review-queue/queries.ts`
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` D5, D6, B12, C14, C15.
- Song mode adds review song to suggestion playlist; playlist mode adds suggestion song to review playlist.
- Reject suggestions not captured for this card.

## Acceptance criteria

- Invalid target shapes return `invalid-target`.
- Uncaptured existing pairs return `not-visible`.
- Successful queue add writes decision/event served context from captured row.
- Direct/non-queue decisions remain unaffected.

## Notes on risks or ambiguity

- Do not trust client-provided orientation; derive it from the queue item.
