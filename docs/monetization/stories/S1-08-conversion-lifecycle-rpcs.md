# S1-08 · Conversion Lifecycle RPCs

## Goal

Implement the five RPCs that manage pack-to-unlimited upgrade conversion: `prepare_subscription_upgrade_conversion`, `link_subscription_upgrade_checkout`, `release_subscription_upgrade_conversion`, `apply_subscription_upgrade_conversion`, `reverse_subscription_upgrade_conversion`.

## Why

When a pack user upgrades to unlimited, unused purchased pack value becomes a first-invoice discount. This lifecycle requires durable reservation, linking, application, release, and reversal. The billing service calls these RPCs at different points in the Stripe checkout flow.

## Depends on

- S1-01 (core tables)
- S1-02 (pack_credit_lot, subscription_credit_conversion, subscription_credit_conversion_allocation)

## Blocks

- Phase 4 (unlimited checkout endpoint, checkout expiry handler, subscription activation handler, refund handler)

## Scope

### `prepare_subscription_upgrade_conversion`
- Creates or reuses a `pending` conversion row + per-lot allocation rows
- Computes `converted_credits` and `discount_cents` from open `pack_credit_lot` rows
- Returns `(converted_credits, discount_cents, conversion_id)`
- FIFO lot selection: `ORDER BY created_at ASC, id ASC`
- At-most-one-pending enforced by partial unique index (should also check in RPC)

### `link_subscription_upgrade_checkout`
- Attaches `checkout_session_id` to the conversion row after Stripe Checkout creation succeeds

### `release_subscription_upgrade_conversion`
- Sets status to `released`; restores reserved credits to lots and `credit_balance`
- Used on checkout expiry/abandonment or Stripe creation failure

### `apply_subscription_upgrade_conversion`
- Consumes reserved credits from lots; deducts from `credit_balance`
- Sets status to `applied`; records Stripe subscription/invoice/event IDs
- Writes `credit_transaction` ledger row

### `reverse_subscription_upgrade_conversion`
- Restores exact allocated lot amounts; increments `credit_balance`
- Sets status to `reversed`
- Used when initial unlimited invoice is refunded/disputed
- Writes `credit_transaction` ledger row

All: `SECURITY DEFINER`, `SET search_path = public`, `SELECT ... FOR UPDATE` on participating rows

## Out of scope

- Subscription activation/deactivation (S1-07)
- Unlimited period reversal (S1-09)
- Billing service endpoints
- TypeScript wrappers

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_conversion_lifecycle_rpcs.sql` |

## Constraints / decisions to honor

- At most one `pending` conversion per account at a time
- Discount derived from `pack_credit_lot` rows, never from `credit_balance` alone
- FIFO lot ordering for deterministic accounting
- `SELECT ... FOR UPDATE` on `account_billing` and participating lots/conversion rows
- Release must fully restore lot state; apply must fully consume
- `conversion_id` is the primary lifecycle identifier

## Acceptance criteria

- [ ] `prepare` creates conversion + allocation rows with correct credit/discount amounts
- [ ] Second `prepare` for same account reuses existing pending conversion
- [ ] `link` attaches checkout session ID to pending conversion
- [ ] `release` restores all reserved lot credits and increments `credit_balance`
- [ ] `apply` consumes exact allocated amounts from lots; writes ledger
- [ ] `reverse` restores exact allocated amounts to lots; writes ledger
- [ ] State transitions enforce valid sequences (pending→applied, pending→released, applied→reversed)
- [ ] No lot credits can be spent while reserved by a pending conversion

## Verification

- SQL tests: full lifecycle (prepare→link→apply), abandonment (prepare→release), reversal (prepare→link→apply→reverse)
- Concurrent prepare attempts for same account
- `supabase db reset` completes

## Parallelization notes

- Can run in parallel with S1-05, S1-06, S1-07

## Suggested PR title

`feat(billing): pack-to-unlimited conversion lifecycle RPCs`
