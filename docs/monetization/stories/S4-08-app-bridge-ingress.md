# S4-08 · App Bridge Ingress Endpoint + Idempotency

## Goal

Create the authenticated HTTP endpoint in `v1_hearted/` that receives billing-service → app bridge calls, with `billing_bridge_event` idempotency.

## Why

The billing service bridges fulfillment and revocation outcomes to the app so the control plane can react. This endpoint is the single ingress for all billing-driven triggers in `v1_hearted/`.

## Depends on

- S4-01 (HMAC auth pattern to verify)
- S1-03 (`billing_bridge_event` table)
- S2-05 (`BillingChanges.*` helpers)

## Blocks

- S4-09 (bridge handlers use this endpoint)

## Scope

- New API route/endpoint in `v1_hearted/` for bridge ingress
- **HMAC verification**: verify incoming request signature using `BILLING_SHARED_SECRET`, timestamp, body hash, replay window
- **`billing_bridge_event` idempotency**: `INSERT ... ON CONFLICT DO NOTHING`; proceed only if insert succeeded; duplicate deliveries are no-ops
- **Event dispatch**: route by `event_kind` to handlers (S4-09)
- Guard: only available when `BILLING_ENABLED=true`

## Out of scope

- Individual bridge handlers (S4-09)
- Billing service endpoints (S4-02–S4-07)
- App-to-billing server functions (S4-10)

## Likely touchpoints

| Area | Files |
|---|---|
| API route | New route/endpoint in `v1_hearted/` (e.g., `src/routes/api/billing-bridge.ts` or server function) |
| Billing domain | HMAC verification utilities |
| Bridge event table | `billing_bridge_event` consumers |

## Constraints / decisions to honor

- Same HMAC pattern as service-to-app bridge calls (timestamp + body hash + replay window)
- `billing_bridge_event` keyed on `stripe_event_id`
- Must check insert result to determine whether to proceed
- Must be provider-enabled only (`BILLING_ENABLED=true`)

## Acceptance criteria

- [ ] Rejects unsigned or stale requests
- [ ] Accepts valid HMAC-signed requests
- [ ] Duplicate `stripe_event_id` deliveries are no-ops
- [ ] Returns success for duplicates (so billing service doesn't retry)
- [ ] Dispatches to correct handler by `event_kind`
- [ ] Not available when `BILLING_ENABLED=false`

## Verification

- Test: valid signed request → accepted and processed
- Test: duplicate delivery → no-op, success response
- Test: invalid signature → rejected
- Test: expired timestamp → rejected

## Parallelization notes

- Lives in `v1_hearted/` — can run in parallel with billing service stories
- New files — minimal merge conflict risk

## Suggested PR title

`feat(billing): app bridge ingress endpoint with HMAC auth and idempotency`
