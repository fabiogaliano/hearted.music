# S4-01 · Billing Service Scaffold + HMAC Auth + Deploy

## Goal

Scaffold the `v1_hearted_brand/` billing service: Bun HTTP server with Hono routing, HMAC auth middleware with replay protection, health endpoint, Dockerfile, and Coolify deploy config.

## Why

Every billing service endpoint needs the same authenticated HTTP foundation. Shipping the scaffold first lets subsequent stories focus on business logic.

## Depends on

- None (can start early; lives in `v1_hearted_brand/` repo)

## Blocks

- S4-02 through S4-07 (all service endpoints need the scaffold)
- S4-08 (app bridge shares HMAC signing logic)

## Scope

- Bun HTTP server with `Bun.serve()`
- Hono routing framework
- **HMAC auth middleware**:
  - Timestamp header + raw body hash + shared secret
  - Clock-skew window (e.g., 5 minutes)
  - Reject stale/replayed requests
- **`/health` endpoint** — health check
- Supabase JS client initialization (service role)
- Stripe SDK initialization
- Environment config: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BILLING_SHARED_SECRET`, `APP_BRIDGE_URL`
- **Dockerfile** for container deployment
- **Coolify deploy config** for `billing.hearted.music`

## Out of scope

- Business endpoints (checkout, portal, webhooks)
- App-side HMAC signing (S4-08)
- Stripe product creation

## Likely touchpoints

| Area | Files |
|---|---|
| Billing service | `v1_hearted_brand/` — `src/index.ts`, `src/middleware/`, `src/config.ts`, `Dockerfile`, deploy config |

## Constraints / decisions to honor

- HMAC auth includes timestamp + body hash + replay window
- Shared secret matches `BILLING_SHARED_SECRET` in `v1_hearted/`
- Only `v1_hearted_brand/` imports Stripe SDK
- Service-role Supabase client for all DB operations

## Acceptance criteria

- [ ] Server starts and `/health` returns 200
- [ ] HMAC middleware rejects unsigned requests
- [ ] HMAC middleware rejects requests with expired timestamps
- [ ] HMAC middleware accepts valid signed requests
- [ ] Dockerfile builds successfully
- [ ] Coolify deploy config targets `billing.hearted.music`

## Verification

- `bun run` starts the server
- curl tests for health and auth rejection
- Docker build succeeds

## Parallelization notes

- Lives in `v1_hearted_brand/` — no conflicts with `v1_hearted/` stories
- Can start before Phase 3 completes (independent repo)

## Suggested PR title

`feat(billing-service): scaffold Bun/Hono server with HMAC auth and deploy config`
