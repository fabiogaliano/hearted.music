# S7-03 · E2E: Refund/Chargeback Flows

## Goal

Validate refund/chargeback reversal for pack purchases and unlimited subscription periods.

## Why

Refund/chargeback handling is the most complex billing operation and the easiest to get wrong. Incorrect reversal can leave users with unearned access or incorrectly revoke legitimate unlocks.

## Depends on

- Phases 1–6 complete

## Blocks

- None

## Scope

### Pack refund
- Full pack refund: 500 purchased balance subtracted + 25 bonus unlocks revoked
- Partial pack refund: proportional balance subtracted, unlocks revoked if balance insufficient
- Verify `free_auto` and `unlimited` unlocks untouched
- Verify newest `source='pack'` unlocks revoked first
- Verify `candidate_access_revoked` emitted → match snapshot refresh triggered

### Unlimited period refund
- Refund of a subscription period: songs unlocked during that period revoked
- Verify reversal key `(granted_stripe_subscription_id, granted_subscription_period_end)` works correctly
- Verify `free_auto` and `pack` unlocks untouched
- Verify `candidate_access_revoked` emitted

### Initial-invoice refund with conversion
- Refund of initial unlimited invoice that consumed a conversion: conversion value restored
- Verify pack balance and lots restored
- Verify unlimited access deactivated

### Failed payment → recovery
- `invoice.payment_failed` → `past_due` state → no new unlimited work
- Recovery payment → `active` → access restored

## Out of scope

- Happy-path flows (S7-01, S7-02)
- Concurrency (S7-04)

## Likely touchpoints

| Area | Files |
|---|---|
| Tests | `tests/` |
| Stripe test mode | Refund/dispute simulation |

## Constraints / decisions to honor

- Pack reversal: 525-song full entitlement footprint (500 balance + 25 bonus)
- Unlimited reversal uses subscription provenance, not row creation time
- Conversion reversal restores exact lot amounts
- Ambiguous cases create admin tasks

## Acceptance criteria

- [ ] Full pack refund correctly reverses entire entitlement
- [ ] Unlimited period refund revokes only that period's unlimited unlocks
- [ ] Free and pack unlocks never revoked by unlimited refund
- [ ] Conversion restored on initial-invoice refund
- [ ] `past_due` blocks new unlimited work; recovery restores it
- [ ] Queue reprioritized after refund

## Verification

- Stripe test-mode refund/dispute simulation
- SQL-level verification of lot, unlock, and balance state after reversals

## Parallelization notes

- Can run in parallel with S7-01, S7-02

## Suggested PR title

`test(billing): e2e validation of refund, chargeback, and failed payment flows`
