# S4-05 · Webhook Endpoint + Pack Fulfillment Handler

## Goal

Implement `/webhooks/stripe` with Stripe signature verification, `billing_webhook_event` idempotency, event dispatch, and the pack fulfillment handler.

## Why

The webhook endpoint is the single ingress for all Stripe events. Pack fulfillment (`checkout.session.completed` with mode=payment) is the simplest fulfillment flow and validates the full webhook pipeline.

## Depends on

- S4-01 (service scaffold)
- S1-06 (`fulfill_pack_purchase` RPC)
- S1-03 (`billing_webhook_event` table)

## Blocks

- S4-06 (subscription handlers share the webhook infrastructure)
- S4-07 (refund/dispute handlers)

## Scope

- **`POST /webhooks/stripe`** endpoint
- Stripe signature verification (not HMAC — Stripe's own verification)
- **`billing_webhook_event` idempotency**:
  - `INSERT INTO billing_webhook_event (stripe_event_id, event_type, status) VALUES (?, ?, 'processing') ON CONFLICT DO NOTHING`
  - Check whether insert succeeded (webhook winner detection)
  - Update to `processed` or `failed` after handling
- **Event dispatch** router: route by `event.type` to handlers
- **Pack fulfillment handler** (`checkout.session.completed`, mode=payment):
  - Extract `account_id` from Checkout metadata
  - Call `fulfill_pack_purchase` RPC
  - Bridge to app: POST to `APP_BRIDGE_URL` with `bonus_unlocked_song_ids` and `stripe_event_id`
  - Mark event `processed`
- **`checkout.session.completed` (mode=subscription)**: store customer/subscription refs only

## Out of scope

- Subscription activation on `invoice.paid` (S4-06)
- Lifecycle/refund handlers (S4-06, S4-07)
- App bridge ingress endpoint (S4-08)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing service | `v1_hearted_brand/src/routes/webhooks.ts`, `src/handlers/` |

## Constraints / decisions to honor

- `billing_webhook_event` with `processed` → skip; `failed` → allow retry
- Insert pattern must tell the worker whether it won ownership
- Pack fulfillment idempotent on `stripe_event_id` (via `pack_credit_lot.stripe_event_id UNIQUE`)
- Bridge call must include HMAC signature

## Acceptance criteria

- [ ] Webhook verifies Stripe signature; rejects invalid
- [ ] Duplicate webhook delivery is a no-op
- [ ] `failed` events are retryable
- [ ] Pack fulfillment calls `fulfill_pack_purchase` and bridges result to app
- [ ] Subscription checkout stores customer/subscription refs without granting access
- [ ] Event marked `processed` on success, `failed` on error

## Verification

- Test: valid pack checkout webhook → fulfillment + bridge call
- Test: duplicate webhook → no-op
- Test: invalid signature → rejected
- Stripe test mode integration

## Parallelization notes

- Lives in `v1_hearted_brand/` — no conflicts with `v1_hearted/`
- S4-06 and S4-07 build on top of this webhook infrastructure

## Suggested PR title

`feat(billing-service): Stripe webhook endpoint with pack fulfillment handler`
