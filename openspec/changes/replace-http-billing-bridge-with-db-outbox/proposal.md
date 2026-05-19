## Why

Billing-to-app control-plane fan-out currently depends on an HTTP bridge from `../v1_hearted_brand/` into `src/routes/api/billing-bridge.ts`. That transport has three correctness costs:

- required payload changes can break staggered deploys (`400` terminal failure on schema drift);
- producer and consumer duplicate the contract in separate repos, so HMAC/wire-schema drift is easy to ship;
- the billing mutation and app invalidation are split across an RPC + HTTP hop, so the mutation can succeed while the control-plane event is lost or delayed behind retry ambiguity.

Recent refund hardening made that transport risk concrete: adding `access_removed` fixed a correctness bug, but also created a deploy-order trap because the receiver now rejects older reversal payloads as terminal bad requests.

The long-term fix is to stop treating billing-to-app fan-out as a cross-service HTTP integration. Both repos already share the same Supabase database and service-role access. Billing domain events should be written durably into the database in the same transaction as the billing mutation, then consumed by the app worker from that durable outbox.

## What Changes

- Add a durable `billing_domain_event` outbox table in the shared app database schema.
- Replace the HTTP bridge contract with versioned DB-backed event envelopes: `event_kind`, `schema_version`, and `payload`.
- Move enqueue responsibility to the same transactional boundary as the billing mutation by introducing SQL orchestration functions that both mutate billing state and insert the matching outbox row.
- Add an app-worker billing event consumer that claims pending rows, upcasts payload versions, applies `BillingChanges.*`, and records retry/failure metadata.
- Add replay tooling for operators to inspect failed events and requeue them intentionally.
- Migrate billing flows in phases: reversal events first, then fulfillment/activation/deactivation, then remove the HTTP bridge route and HMAC bridge client.
- Tighten Stripe webhook success semantics so webhook delivery is acknowledged only after the billing mutation + outbox enqueue succeeds.

## Capabilities

### New Capabilities

- `billing-domain-events`: durable outbox/inbox delivery for billing-originated control-plane events.

### Modified Capabilities

- `library-processing`: billing-originated changes now enter through the billing domain event consumer instead of the HTTP bridge route.

## Affected specs

- `openspec/specs/library-processing/spec.md`
- `openspec/specs/billing-domain-events/spec.md` (new)

## Impact

- **Architecture:** billing-service → app fan-out becomes DB-backed instead of HTTP/HMAC-backed.
- **Data:** add `billing_domain_event` table plus claim/finalize/requeue RPCs and regenerated `src/lib/data/database.types.ts`.
- **App files likely touched:**
  - `supabase/migrations/*_billing_domain_events.sql`
  - `src/lib/data/database.types.ts`
  - `src/lib/domains/billing/bridge-handlers.ts` (or renamed successor used by the consumer)
  - `src/lib/domains/billing/events/*`
  - `src/worker/index.ts`
  - `src/worker/config.ts`
  - `src/worker/billing-domain-events.ts`
  - `src/routes/api/billing-bridge.ts` (deprecated then removed)
  - `scripts/billing/*.ts`
- **Billing-service files likely touched:**
  - `../v1_hearted_brand/src/handlers/checkout-completed.ts`
  - `../v1_hearted_brand/src/handlers/refund.ts`
  - `../v1_hearted_brand/src/handlers/subscription.ts`
  - `../v1_hearted_brand/src/lib/bridge.ts` (removed)
  - `../v1_hearted_brand/src/routes/webhooks.ts`
- **Operations:** adds durable inspection/replay surfaces for failed billing events; removes HMAC secret dependence for internal fan-out.
- **Verification:** focused billing consumer + webhook tests, `bun run typecheck`, `bun run test`, and `openspec validate replace-http-billing-bridge-with-db-outbox --strict --no-interactive`.
