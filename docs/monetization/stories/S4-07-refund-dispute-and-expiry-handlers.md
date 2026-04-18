# S4-07 · Refund/Dispute + Checkout Expiry Handlers

## Goal

Implement webhook handlers for refunds, chargebacks, and checkout expiry.

## Why

Refund/chargeback reversal is the most complex billing operation. Checkout expiry must release pending conversion reservations. Both are required for billing correctness.

## Depends on

- S4-05 (webhook endpoint)
- S1-06 (`reverse_pack_entitlement`)
- S1-08 (`reverse_subscription_upgrade_conversion`)
- S1-09 (`reverse_unlimited_period_entitlement`)
- S1-07 (`deactivate_subscription`, `update_subscription_state`)

## Blocks

- S4-08 (app bridge receives revocation outcomes)

## Scope

### `checkout.session.expired`
- Read `conversion_id` from Stripe metadata
- Call `release_subscription_upgrade_conversion` to free reserved pack value

### `charge.refunded` / `charge.dispute.created`
**For pack purchases:**
- Call `reverse_pack_entitlement` (subtracts balance, revokes newest pack unlocks)
- Bridge to app: revocation outcome

**For initial unlimited invoice:**
- Call `reverse_subscription_upgrade_conversion` (restore converted pack value)
- Call `reverse_unlimited_period_entitlement` (revoke period's unlock rows)
- Call `deactivate_subscription` or `update_subscription_state` as appropriate
- Bridge to app: revocation outcome
- Ensure pending jobs reprioritized to final post-refund band

**Ambiguous cases:**
- Create admin task for manual review

## Out of scope

- Subscription lifecycle events (S4-06)
- Pack fulfillment (S4-05)
- App-side revocation handling (S4-08)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing service | `v1_hearted_brand/src/handlers/refund.ts`, `src/handlers/expiry.ts` |

## Constraints / decisions to honor

- Full pack refund reverses 525-song footprint (500 balance + 25 bonus unlocks)
- Never revoke `free_auto`, `self_hosted`, or `admin` unlocks through pack refund
- Unlimited reversal uses `(granted_stripe_subscription_id, granted_subscription_period_end)` as reversal key
- If initial invoice refunded AND consumed a conversion, restore that conversion first
- All handlers idempotent via `billing_webhook_event`
- Refund flows must leave pending jobs reprioritized to final post-refund band

## Acceptance criteria

- [ ] Checkout expiry releases pending conversion
- [ ] Pack refund reverses full pack entitlement
- [ ] Unlimited period refund revokes period unlock rows
- [ ] Initial-invoice refund restores converted pack value
- [ ] Bridge calls sent for revocation outcomes
- [ ] Pending jobs reprioritized after refund
- [ ] Ambiguous cases create admin task

## Verification

- Test: pack refund → balance subtracted, unlocks revoked
- Test: unlimited refund → period songs revoked, conversion restored
- Test: checkout expiry → conversion released
- Stripe test mode integration

## Parallelization notes

- Builds on S4-05; can run in parallel with S4-06

## Suggested PR title

`feat(billing-service): refund, dispute, and checkout expiry webhook handlers`
