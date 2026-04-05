# S4-03 · Unlimited Checkout Endpoint

## Goal

Implement `/checkout/unlimited` — creates a Stripe Checkout session for unlimited subscription with optional pack-to-unlimited upgrade discount.

## Why

This endpoint handles the most complex checkout flow: it must reserve unused purchased pack value, create a first-invoice discount, handle Stripe creation failure gracefully, and link the conversion to the Checkout session.

## Depends on

- S4-01 (service scaffold)
- S1-08 (conversion lifecycle RPCs)
- Stripe test-mode products (quarterly, yearly)

## Blocks

- S4-05 (subscription activation handler)
- S4-07 (checkout expiry handler)

## Scope

- **`POST /checkout/unlimited`** endpoint
- Request body: `{ account_id, offer_id, checkout_attempt_id }`
- Validate `offer_id` ∈ `{unlimited_quarterly, unlimited_yearly}`; reject `unlimited_quarterly` if `QUARTERLY_PLAN_ENABLED=false`
- If open `pack_credit_lot` rows exist:
  1. Call `prepare_subscription_upgrade_conversion`
  2. Create one-time Stripe coupon for `discount_cents`
  3. Create Stripe Checkout with coupon applied to first invoice
  4. Call `link_subscription_upgrade_checkout` with returned session ID
  5. If coupon or Checkout creation fails: call `release_subscription_upgrade_conversion` before returning error
- If no pack lots: create Checkout without discount
- Forward `checkout_attempt_id` as Stripe `idempotency_key`
- Set `subscription_data.metadata: { account_id, conversion_id? }`
- Return `{ checkout_url }`

## Out of scope

- Pack checkout (S4-02)
- Webhook fulfillment (S4-05)
- Portal (S4-04)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing service | `v1_hearted_brand/src/routes/checkout.ts` |

## Constraints / decisions to honor

- Conversion reservation must be released on any failure after prepare
- `conversion_id` in metadata so webhooks can resolve reservation
- `QUARTERLY_PLAN_ENABLED` flag gates quarterly availability
- Pack purchase entry points blocked while unlimited active (app-side concern, but endpoint should also reject if already unlimited)

## Acceptance criteria

- [ ] Creates Stripe Checkout for quarterly or yearly subscription
- [ ] Applies first-invoice discount from unused pack value when applicable
- [ ] Releases conversion reservation on Stripe creation failure
- [ ] `conversion_id` included in subscription metadata
- [ ] Rejects `unlimited_quarterly` when `QUARTERLY_PLAN_ENABLED=false`
- [ ] Rejects checkout if account already has active unlimited

## Verification

- Test: checkout with pack value → discount applied
- Test: checkout without pack value → no discount
- Test: Stripe failure after prepare → conversion released
- Integration test with Stripe test mode

## Parallelization notes

- Lives in `v1_hearted_brand/` — can run in parallel with S4-02, S4-04

## Suggested PR title

`feat(billing-service): unlimited checkout endpoint with conversion discount`
