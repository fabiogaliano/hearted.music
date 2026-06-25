# MSR-23 — Capture visible pairs RPC implementation

## Goal

Implement atomic first-presentation capture so retries and multi-tab races return the original visible ranks.

## Depends on / blocks

Depends on:

- MSR-07
- MSR-22

Blocks:

- MSR-24
- MSR-26
- MSR-27
- MSR-28

## Scope and out of scope

In scope:

- Implement `capture_match_review_item_visible_pairs_atomic(p_item_id, p_account_id, p_pairs)`.
- Lock owned queue item `FOR UPDATE`.
- Validate JSON shape, dense ranks, subject/orientation/snapshot/account/session consistency, and pair membership.
- Handle `captured`, `already_captured`, `empty`, `not_found`, `already_resolved`, and `invalid_input` statuses.
- Set `visible_pairs_captured_at` and mark item active in the same transaction.
- Add SQL/RPC integration tests.

Out of scope:

- Server `presentMatchReviewItem` mapping.
- Action mutation RPCs.
- UI rendering.

## Likely touchpoints

- `supabase/migrations/**capture_match_review_item_visible_pairs_atomic**`
- `src/lib/data/database.types.ts` if regenerated
- RPC tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` D3, D4, B11.
- First capture wins; existing captured rows are returned ordered by visible rank.
- Empty capture still sets captured timestamp and active state.

## Acceptance criteria

- Malformed input returns `invalid_input` with no insert.
- Duplicate/non-dense visible ranks are rejected.
- Already captured items ignore new input and return original rows.
- Foreign/resolved/mismatched items are rejected as specified.

## Notes on risks or ambiguity

- JSONB validation in PL/pgSQL can get complex; keep tests explicit for bad shape and race/idempotency cases.
