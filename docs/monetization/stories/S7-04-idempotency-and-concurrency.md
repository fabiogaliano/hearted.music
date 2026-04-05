# S7-04 · Idempotency + Concurrency Test Suite

## Goal

Validate that duplicate webhook/bridge deliveries are safe and concurrent billing operations do not corrupt state.

## Why

Stripe webhooks can be delivered multiple times. Users can trigger overlapping operations. These scenarios must be provably safe.

## Depends on

- Phases 1–6 complete

## Blocks

- None

## Scope

### Idempotency
- Duplicate webhook delivery for each event type → no double-charge, no duplicate control-plane effects
- Duplicate bridge delivery → no-op via `billing_bridge_event`
- Duplicate unlock requests → no double-charge via `UNIQUE(account_id, song_id)`
- Duplicate pack fulfillment → no-op via `pack_credit_lot.stripe_event_id UNIQUE`

### Concurrency
- Concurrent unlock requests for overlapping song sets → correct balance, no double unlock
- Concurrent pack purchase + unlimited checkout → no corrupted conversion state
- Content activation during unlimited deactivation window → re-checks entitlement at activation time
- Bridge delivery during subscription lifecycle transitions → correct final state

## Out of scope

- Happy-path flows (S7-01, S7-02)
- Refund flows (S7-03)
- Performance testing

## Likely touchpoints

| Area | Files |
|---|---|
| Tests | `tests/` |
| All billing RPCs |
| Bridge handlers |

## Constraints / decisions to honor

- `SELECT ... FOR UPDATE` on `account_billing` for all balance mutations
- `billing_webhook_event` and `billing_bridge_event` provide idempotency boundaries
- All-or-nothing unlock semantics

## Acceptance criteria

- [ ] Duplicate webhooks for every event type are no-ops
- [ ] Duplicate bridge calls are no-ops
- [ ] Duplicate unlock requests → no double-charge
- [ ] Concurrent overlapping unlocks → correct balance and unlock count
- [ ] No deadlocks under concurrent billing operations
- [ ] Content activation during deactivation → entitlement re-checked, not stale

## Verification

- Automated tests with concurrent SQL transactions
- Manual duplicate webhook injection via Stripe test mode

## Parallelization notes

- Can run in parallel with S7-01 through S7-03

## Suggested PR title

`test(billing): idempotency and concurrency validation for billing operations`
