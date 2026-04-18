# Feature: Billing Service & App Bridge

> **Feature 04** · Dependency: Features 01–03

## Goal

Connect Stripe-backed billing to the already-safe app foundation: build the hosted billing service in `v1_hearted_brand/`, wire checkout/portal/webhook flows, and integrate the billing-service → app bridge so purchase events trigger canonical control-plane reactions.

## Why it exists

The public app enforces entitlement and gating (Features 01–03), but cannot process real purchases or Stripe lifecycle events without the billing service. This feature creates the external billing boundary, the authenticated bridge between the two repos, and the server functions the app uses to initiate checkout/portal sessions. It ships after enforcement so that Stripe integration targets stable schema, RPCs, and app-side change contracts.

## What this feature owns

### Billing service (`v1_hearted_brand/`)

- Bun HTTP server with Hono (or equivalent) routing
- **HMAC auth middleware** with replay protection (timestamp + body hash + clock-skew window)
- **`/checkout/pack`** — creates Stripe Checkout (mode=payment); forwards `checkout_attempt_id` as Stripe `idempotency_key`
- **`/checkout/unlimited`** — calls `prepare_subscription_upgrade_conversion` if open pack lots exist; creates Stripe Checkout (mode=subscription) with first-invoice discount; calls `link_subscription_upgrade_checkout`; releases conversion on Stripe/coupon creation failure
- **`/portal/session`** — creates Stripe Customer Portal session (cancel + payment update enabled; plan switching disabled)
- **`/webhooks/stripe`** — Stripe signature verification; idempotent event handling via `billing_webhook_event`
- **`/health`** — health check
- **Webhook handlers**:
  - `checkout.session.completed` (payment) → `fulfill_pack_purchase` → bridge pack fulfillment to app
  - `checkout.session.completed` (subscription) → store customer/subscription refs
  - `checkout.session.expired` → `release_subscription_upgrade_conversion`
  - `invoice.paid` (initial) → apply conversion if present → `activate_subscription` → bridge unlimited activation to app
  - `invoice.paid` (renewal) → `update_subscription_state`
  - `invoice.payment_failed` → `update_subscription_state` (past_due)
  - `customer.subscription.updated` → `update_subscription_state` (cancel/uncancel)
  - `customer.subscription.deleted` → `deactivate_subscription`
  - `charge.refunded` / `charge.dispute.created` → pack reversal OR unlimited reversal + conversion reversal → bridge revocation to app
- **Stripe customer reuse** — reuse `account_billing.stripe_customer_id` when it exists
- **Metadata strategy** — `{ account_id, conversion_id? }` on Checkout Session and subscription metadata
- **Dockerfile + Coolify deploy config** for `billing.hearted.music`

### App bridge (`v1_hearted/`)

- **Billing bridge ingress endpoint** — authenticated HTTP route that receives bridge calls from the billing service
- **`billing_bridge_event` idempotency** — `INSERT ... ON CONFLICT DO NOTHING`; proceed only if insert succeeded
- **Bridge handlers**:
  - Pack fulfillment → emit `BillingChanges.songsUnlocked(accountId, bonusUnlockedSongIds)`
  - Unlimited activation → insert `billing_activation` marker → emit `BillingChanges.unlimitedActivated(accountId)`
  - Revocation outcomes → determine whether access actually removed → emit `BillingChanges.candidateAccessRevoked(accountId)` if so
- **Server function bridges** (provider-enabled only):
  - `createCheckoutSession({ offer, checkoutAttemptId })` → signs + calls billing service
  - `createPortalSession()` → signs + calls billing service
  - Both fail fast with typed error when `BILLING_ENABLED=false`

## What it does not own

- SQL schema or RPCs — Feature 01
- App billing domain types, `BillingState`, or queue-band mapping — Feature 02
- Pipeline gating or read-model enforcement — Feature 03
- Onboarding step sequencing or free allocation — Feature 05
- In-app purchase/paywall/selection UI — Feature 06
- Stripe test-mode product creation (Phase 0 / setup task)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing service | `v1_hearted_brand/` — server, routes, handlers, middleware, deploy config |
| App bridge route | `v1_hearted/` — new API route or server function for bridge ingress |
| App server functions | `src/lib/server/billing.functions.ts` *(new)* |
| Billing domain | `src/lib/domains/billing/*` (bridge handler logic, HMAC signing) |
| Bridge event table | `billing_bridge_event` consumers |
| Activation table | `billing_activation` consumers |

## Dependencies

- Feature 01 complete (all RPCs the billing service calls exist)
- Feature 02 complete (env config, `BillingChanges.*` helpers, bridge event types stable)
- Feature 03 complete (app is entitlement-safe; bridge-triggered control-plane changes have a working reconciler)
- Stripe test-mode products created (pack, quarterly, yearly)
- Coolify + domain setup for `billing.hearted.music`

## Downstream stories this feature should split into

### Billing service

1. **Service scaffold** — Bun HTTP server, Hono routing, health endpoint, Dockerfile, Coolify config
2. **HMAC auth middleware** — timestamp + body-hash verification with replay window; shared-secret config
3. **Pack checkout endpoint** — `/checkout/pack`; Stripe Checkout creation with `checkout_attempt_id` as `idempotency_key`; customer reuse; metadata
4. **Unlimited checkout endpoint** — `/checkout/unlimited`; conversion reservation → discount creation → Checkout creation → link checkout; release on failure
5. **Portal session endpoint** — `/portal/session`; Customer Portal with cancel + payment update
6. **Stripe webhook endpoint + event dispatch** — signature verification; `billing_webhook_event` idempotency; webhook winner detection; event routing
7. **Pack fulfillment handler** — `checkout.session.completed` (payment) → `fulfill_pack_purchase` → bridge to app
8. **Subscription activation handler** — `checkout.session.completed` (subscription) + `invoice.paid` (initial) → conversion apply → `activate_subscription` → bridge to app
9. **Subscription lifecycle handlers** — renewal, payment failure, cancel/uncancel, deletion → appropriate RPCs
10. **Refund/dispute handlers** — pack reversal, unlimited-period reversal, conversion reversal → bridge revocation to app
11. **Checkout expiry handler** — `checkout.session.expired` → `release_subscription_upgrade_conversion`

### App bridge

12. **Bridge ingress endpoint** — authenticated route in `v1_hearted/`; HMAC verification; `billing_bridge_event` idempotency
13. **Bridge pack fulfillment handler** — emits `BillingChanges.songsUnlocked`
14. **Bridge unlimited activation handler** — inserts `billing_activation` marker; emits `BillingChanges.unlimitedActivated`
15. **Bridge revocation handler** — determines access impact; emits `BillingChanges.candidateAccessRevoked` when warranted
16. **`createCheckoutSession` server function** — HMAC-signed call to billing service; `checkout_attempt_id` in signed body; provider-disabled guard
17. **`createPortalSession` server function** — HMAC-signed call to billing service; provider-disabled guard

## Definition of done

- Pack purchase completes in Stripe test mode and updates `account_billing.credit_balance` + creates `pack_credit_lot` + writes `credit_transaction` ledger + triggers `songs_unlocked` in app
- Unlimited checkout reserves/applies/releases conversion correctly across happy path, expiry, and Stripe creation failure
- Unlimited activation sets `unlimited_access_source = 'subscription'` and triggers `unlimited_activated` in app
- Subscription lifecycle (renewal, cancel, uncancel, deletion, payment failure) updates billing state correctly
- Refund/dispute reverses entitlement and triggers `candidate_access_revoked` in app
- Bridge calls are HMAC-authenticated with replay protection
- Duplicate webhook deliveries are safe (`billing_webhook_event`)
- Duplicate bridge deliveries are safe (`billing_bridge_event`)
- `createCheckoutSession` and `createPortalSession` fail fast with typed error when `BILLING_ENABLED=false`
- Billing service deploys to `billing.hearted.music` via Coolify
