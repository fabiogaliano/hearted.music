# MSR-27 — Dismiss mutation from captured visible pairs

## Goal

Dismiss all captured visible suggestions for the current queue item without recomputing ranks at action time.

## Depends on / blocks

Depends on:

- MSR-24
- MSR-26

Blocks:

- MSR-28
- MSR-31

## Scope and out of scope

In scope:

- Implement `dismiss_match_review_item_atomic(p_item_id, p_account_id)` using captured rows.
- Server derives/captures first if needed before dismiss; returns `derive-failed` if derivation yields no capture when required by plan.
- Resolve item as dismissed and insert dismissed decisions/events for captured pairs without added decisions for the same queue item.
- Populate served context from captured rows.
- Map statuses to public kebab-case reasons.
- Add tests for both orientations, no captured rows, already resolved, and added-pair exclusion.

Out of scope:

- Finish/skip mutation behavior.
- UI copy changes.

## Likely touchpoints

- `supabase/migrations/**dismiss_match_review_item_atomic**`
- `src/lib/server/match-review-queue.functions.ts`
- `src/lib/domains/taste/match-review-queue/queries.ts`
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` D7, B12, H3.
- Dismiss uses captured visible rows as authority.
- Do not write dismissed decisions for pairs already added on the same queue item.

## Acceptance criteria

- Dismiss resolves queue item with state `resolved`, resolution `dismissed`.
- Events/decisions include `served_orientation`, `model_rank`, and `visible_rank`.
- Expected failure statuses map to documented public reasons.
- Ranks do not re-dense during dismiss.

## Notes on risks or ambiguity

- Clarify in tests whether empty captured rows should resolve unavailable/skipped through finish path, not dismiss success.
