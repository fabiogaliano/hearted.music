# S4-04 · Portal Session Endpoint

## Goal

Implement `/portal/session` — creates a Stripe Customer Portal session for subscription management.

## Why

Users need to manage payment methods and cancel subscriptions. The Customer Portal is the Stripe-hosted management surface.

## Depends on

- S4-01 (service scaffold)

## Blocks

- S6-05 (portal launch from settings)

## Scope

- **`POST /portal/session`** endpoint
- Request body: `{ account_id }`
- Look up `stripe_customer_id` from `account_billing`
- Create Stripe Customer Portal session
- Portal config: cancel enabled, payment update enabled, plan switching **disabled**
- Return `{ portal_url }`

## Out of scope

- Plan switching (intentionally disabled in v1)
- Checkout endpoints
- App-side server function (S4-09)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing service | `v1_hearted_brand/src/routes/portal.ts` |

## Constraints / decisions to honor

- Plan switching disabled — user re-subscribes after active term ends
- Only accounts with `stripe_customer_id` can create portal sessions
- No business-idempotency contract needed for portal (duplicate sessions acceptable)

## Acceptance criteria

- [ ] Returns valid Customer Portal URL
- [ ] Cancel subscription enabled
- [ ] Payment method update enabled
- [ ] Plan switching disabled
- [ ] Rejects accounts without `stripe_customer_id`

## Verification

- Integration test with Stripe test mode

## Parallelization notes

- Small story; can run in parallel with S4-02, S4-03

## Suggested PR title

`feat(billing-service): customer portal session endpoint`
