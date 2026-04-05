# S7-02 · E2E: Unlimited Activation + Renewal + Cancellation

## Goal

Validate end-to-end: unlimited checkout → activation → full-library processing → renewal → cancellation → post-period behavior.

## Why

The unlimited subscription lifecycle involves multiple Stripe events and billing state transitions. Each must be verified in sequence.

## Depends on

- Phases 1–6 complete

## Blocks

- None

## Scope

- Unlimited activation: checkout → `invoice.paid` → `activate_subscription` → bridge → `unlimited_activated` → full processing
- Renewal: simulated `invoice.paid` (cycle) → `update_subscription_state`
- Cancellation: portal cancel → `cancel_at_period_end = true` → `ending` state → period end → `deactivate_subscription` → locked new songs
- Uncancel before period end: `cancel_at_period_end = false` → access continues
- Verify unlimited unlock rows persist after cancellation
- Verify new songs after cancellation require credits
- Verify conversion discount applied correctly (if user had pack balance)

## Out of scope

- Refund/chargeback (S7-03)
- Concurrency (S7-04)

## Likely touchpoints

| Area | Files |
|---|---|
| Tests | `tests/` |
| Stripe test mode | Webhook simulation |

## Constraints / decisions to honor

- Normal cancellation does NOT restore converted pack value
- Previously unlocked songs stay unlocked after cancellation
- `past_due` does not grant unlimited access

## Acceptance criteria

- [ ] Unlimited activation → full-library processing starts
- [ ] Renewal refreshes lifecycle state
- [ ] Cancellation sets `ending` state; access continues through period
- [ ] Deactivation reverts to free; new songs are locked
- [ ] Uncancel restores full access
- [ ] Previously unlocked songs remain accessible after cancellation

## Verification

- Stripe test-mode simulation of full lifecycle
- Integration tests

## Parallelization notes

- Can run in parallel with S7-01, S7-03

## Suggested PR title

`test(billing): e2e validation of unlimited activation, renewal, and cancellation`
