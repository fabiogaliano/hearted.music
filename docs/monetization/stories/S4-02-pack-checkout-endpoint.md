# S4-02 · Pack Checkout Endpoint

## Goal

Implement `/checkout/pack` in the billing service — creates a Stripe Checkout session for song pack purchase.

## Why

This is the entry point for pack purchases. The app calls this endpoint to get a Stripe Checkout URL.

## Depends on

- S4-01 (service scaffold + HMAC auth)
- Stripe test-mode product created (song pack $5.99)

## Blocks

- S4-05 (pack fulfillment handler processes the checkout completion)

## Scope

- **`POST /checkout/pack`** endpoint
- Request body: `{ account_id, offer_id, checkout_attempt_id }`
- Validate `offer_id` = `song_pack_500`
- Resolve Stripe price ID from internal offer ID
- Reuse `account_billing.stripe_customer_id` if exists; create new Stripe customer if not
- Forward `checkout_attempt_id` as Stripe `idempotency_key` on `checkout.sessions.create`
- Set `metadata: { account_id }` on Checkout Session
- Return `{ checkout_url }`

## Out of scope

- Unlimited checkout (S4-03)
- Webhook fulfillment (S4-05)
- App-side server function (S4-09)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing service | `v1_hearted_brand/src/routes/checkout.ts` or similar |

## Constraints / decisions to honor

- Only the billing service resolves Stripe price IDs — app sends internal offer IDs
- `checkout_attempt_id` reused across retries of the same intent; new UUID if offer changes
- Stripe customer reuse prevents duplicate customers

## Acceptance criteria

- [ ] Returns valid Stripe Checkout URL for pack purchase
- [ ] `checkout_attempt_id` forwarded as Stripe `idempotency_key`
- [ ] Reuses existing Stripe customer when `stripe_customer_id` exists
- [ ] Creates new Stripe customer when needed
- [ ] Metadata includes `account_id`
- [ ] Rejects invalid offer IDs

## Verification

- Integration test with Stripe test mode
- Duplicate requests with same `checkout_attempt_id` return same session

## Parallelization notes

- Lives in `v1_hearted_brand/` — no conflicts with `v1_hearted/` work
- Can run in parallel with S4-03, S4-04

## Suggested PR title

`feat(billing-service): pack checkout endpoint`
