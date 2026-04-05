# S1-06 · Credit & Pack RPCs

## Goal

Implement `grant_credits`, `fulfill_pack_purchase`, and `reverse_pack_entitlement`.

## Why

`fulfill_pack_purchase` is the canonical pack fulfillment path called by the billing service on `checkout.session.completed`. `grant_credits` handles operational/replacement balance grants. `reverse_pack_entitlement` handles refund/chargeback reversal. All three are prerequisites for the billing service's webhook handlers.

## Depends on

- S1-01 (core tables)
- S1-02 (pack_credit_lot)
- S1-05 (insert_song_unlocks_without_charge — called by fulfill_pack_purchase for bonus unlocks)
- S1-10 (reprioritize RPC — called as final step; if not yet available, wire the call site with a placeholder that will be filled by S1-10)

## Blocks

- Phase 4 (billing service pack fulfillment handler)

## Scope

### `grant_credits`
- Adds credits to `credit_balance`, writes `credit_transaction` ledger row
- Used for `replacement_grant` and `admin_adjustment` only
- Must NOT create `pack_credit_lot` rows
- `SELECT ... FOR UPDATE` on `account_billing`

### `fulfill_pack_purchase`
- Idempotent on `stripe_event_id` (via `pack_credit_lot.stripe_event_id UNIQUE`)
- Grants 500 purchased credits → creates `pack_credit_lot` row + increments `credit_balance`
- Auto-unlocks up to 25 most-recent currently liked songs not already unlocked (`source='pack'`, no balance deduction)
- Writes `credit_transaction` ledger row
- Calls `reprioritize_pending_jobs_for_account` as final step
- Returns `new_balance` and `bonus_unlocked_song_ids`

### `reverse_pack_entitlement`
- Subtracts refunded credits from purchased balance
- If refunded amount exceeds current balance, revokes newest active `source='pack'` unlocks
- Full pack refund reverses whole entitlement (500 purchased + 25 bonus unlocks)
- Never revokes `free_auto`, `unlimited`, `self_hosted`, or `admin` unlocks
- Writes `credit_transaction` ledger row
- Calls `reprioritize_pending_jobs_for_account` as final step

All: `SECURITY DEFINER`, `SET search_path = public`

## Out of scope

- Conversion RPCs (S1-08)
- Bridge handlers or TypeScript wrappers
- Control-plane change emission

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_credit_and_pack_rpcs.sql` |

## Constraints / decisions to honor

- `grant_credits` must never create upgrade-convertible pack value
- `fulfill_pack_purchase` must be idempotent at the Stripe-event level
- Bonus unlocks are part of pack entitlement — reversed on refund
- FIFO lot consumption for balance deduction during reversal
- `SELECT ... FOR UPDATE` on `account_billing` for all balance mutations

## Acceptance criteria

- [ ] `grant_credits` increases balance without creating a lot row
- [ ] `fulfill_pack_purchase` is idempotent — second call with same `stripe_event_id` is a no-op
- [ ] Pack fulfillment creates exactly one `pack_credit_lot` row
- [ ] Bonus unlocks are capped at 25 and only target non-unlocked currently liked songs
- [ ] `reverse_pack_entitlement` correctly subtracts balance and revokes pack unlocks when needed
- [ ] Full pack refund reverses the complete 525-song entitlement footprint
- [ ] Ledger rows written for every balance mutation
- [ ] `reprioritize_pending_jobs_for_account` called as final step in both `fulfill_pack_purchase` and `reverse_pack_entitlement`

## Verification

- SQL tests: pack fulfillment, duplicate fulfillment, partial refund, full refund, refund exceeding balance
- `supabase db reset` completes

## Parallelization notes

- Depends on S1-05 (for `insert_song_unlocks_without_charge`)
- Can run in parallel with S1-07 and S1-08

## Suggested PR title

`feat(billing): credit grant, pack fulfillment, and pack reversal RPCs`
