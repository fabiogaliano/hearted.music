# S4-06 · Subscription Activation + Lifecycle Handlers

## Goal

Implement webhook handlers for subscription activation (`invoice.paid`), renewal, payment failure, cancel/uncancel, and deletion.

## Why

These handlers complete the subscription lifecycle in the billing service. Without them, unlimited subscriptions cannot be activated, renewed, or gracefully ended.

## Depends on

- S4-05 (webhook endpoint + event dispatch)
- S1-07 (subscription lifecycle RPCs)
- S1-08 (conversion RPCs — `apply_subscription_upgrade_conversion`)

## Blocks

- S4-08 (app bridge receives unlimited activation)

## Scope

### `invoice.paid` (billing_reason=subscription_create)
- Read `conversion_id` from subscription metadata
- If present: call `apply_subscription_upgrade_conversion`
- Call `activate_subscription` RPC
- Bridge to app: unlimited activation with `stripe_event_id`, `account_id`, `stripe_subscription_id`, `subscription_period_end`

### `invoice.paid` (billing_reason=subscription_cycle)
- Call `update_subscription_state` — confirm continued access

### `invoice.payment_failed`
- Call `update_subscription_state` to reflect `past_due`

### `customer.subscription.updated`
- Call `update_subscription_state` for cancel/uncancel/status changes
- Handle `cancel_at_period_end` changes

### `customer.subscription.deleted`
- Call `deactivate_subscription` RPC
- Bridge to app: subscription deactivated

## Out of scope

- Refund/dispute handling (S4-07)
- Checkout expiry (S4-07)
- Pack fulfillment (S4-05)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing service | `v1_hearted_brand/src/handlers/subscription.ts` |

## Constraints / decisions to honor

- Initial activation must apply any pending conversion before `activate_subscription`
- Renewals do NOT re-activate — just refresh lifecycle fields
- `deactivate_subscription` does NOT restore converted pack value
- All handlers are idempotent via `billing_webhook_event`

## Acceptance criteria

- [ ] Initial `invoice.paid` applies conversion (if present) then activates subscription
- [ ] Renewal `invoice.paid` refreshes lifecycle state only
- [ ] `payment_failed` sets `past_due` state
- [ ] Cancel sets `cancel_at_period_end = true`
- [ ] Uncancel clears `cancel_at_period_end`
- [ ] Deletion deactivates subscription
- [ ] Unlimited activation bridged to app
- [ ] All handlers idempotent

## Verification

- Test each webhook event type with Stripe test mode
- Duplicate delivery for each event type → no-op

## Parallelization notes

- Lives in `v1_hearted_brand/` — builds on S4-05 webhook infra
- Can run in parallel with S4-04

## Suggested PR title

`feat(billing-service): subscription activation and lifecycle webhook handlers`
