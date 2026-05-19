## 1. Shared DB outbox schema

- [ ] 1.1 Add `supabase/migrations/<timestamp>_billing_domain_events.sql` creating `billing_domain_event`, indexes, `updated_at` trigger wiring, and service-role-only RPCs for claim/process/retry/fail/requeue.
- [ ] 1.2 Regenerate `src/lib/data/database.types.ts` so `billing_domain_event` and new RPC signatures are typed.
- [ ] 1.3 Add SQL tests or app integration coverage proving `(stripe_event_id, event_kind)` dedupe, lease-safe claim behavior, retry scheduling via `available_at`, and operator requeue semantics.

## 2. App-side billing event consumer

- [ ] 2.1 Create `src/lib/domains/billing/events/schema.ts` with per-kind Zod schemas for the canonical event kinds, `schema_version` envelope parsing, and upcasters to one current in-memory shape.
- [ ] 2.2 Create `src/lib/domains/billing/events/repository.ts` wrapping the new claim/finalize/requeue RPCs with typed Result-style errors.
- [ ] 2.3 Create `src/lib/domains/billing/events/dispatch.ts` that maps current billing event payloads to `BillingChanges.*` via the existing billing handler logic.
- [ ] 2.4 Add `src/worker/billing-domain-events.ts` implementing the 5s poll loop, 20-row batch claim, 5-minute lease, exponential retry backoff, and max-attempt terminal failure.
- [ ] 2.5 Wire the new loop into `src/worker/index.ts` and `src/worker/config.ts`, including shutdown/drain accounting and health-safe error logging.
- [ ] 2.6 Add focused tests under `src/lib/domains/billing/__tests__/` and `src/worker/__tests__/` covering canonical payload parsing per event kind, version upcast, successful dispatch, retryable failure, terminal failure, and replay after requeue.

## 3. Billing-service transactional enqueue

- [ ] 3.1 Replace `../v1_hearted_brand/src/lib/bridge.ts` transport calls by adding orchestration RPC usage in `../v1_hearted_brand/src/handlers/refund.ts` for `pack_reversed` and `unlimited_period_reversed` so mutation + outbox enqueue happen in one DB transaction.
- [ ] 3.2 Migrate `../v1_hearted_brand/src/handlers/checkout-completed.ts` to orchestration RPCs that enqueue `pack_fulfilled` in the same transaction as fulfillment.
- [ ] 3.3 Migrate `../v1_hearted_brand/src/handlers/subscription.ts` to orchestration RPCs that enqueue `unlimited_activated` and `subscription_deactivated` in the same transaction as activation/deactivation.
- [ ] 3.4 Remove `../v1_hearted_brand/src/lib/bridge.ts` once no billing handler imports it.
- [ ] 3.5 Add or update billing-service tests in `../v1_hearted_brand/tests/` proving each migrated webhook path writes the expected outbox row, including `access_removed` for reversal events.

## 4. Webhook acknowledgement semantics

- [ ] 4.1 Add reclaimable `billing_webhook_event` claim/finalize/fail SQL or service-role RPC support so failed or stale webhook deliveries can be retried safely by later Stripe redelivery.
- [ ] 4.2 Refactor `../v1_hearted_brand/src/lib/webhook-event.ts` and `../v1_hearted_brand/src/handlers/*.ts` to use explicit success/failure outcomes instead of only mutating `billing_webhook_event` side effects.
- [ ] 4.3 Update `../v1_hearted_brand/src/routes/webhooks.ts` so pre-enqueue failures return `500` to Stripe while durable post-enqueue app-consumer failures stay internal to `billing_domain_event` retries.
- [ ] 4.4 Add webhook route tests proving failed mutation/enqueue paths are reclaimable and retryable at the Stripe boundary, stale processing rows can be recovered, and already-processed duplicate deliveries still return 200.

## 5. Replay tooling and docs

- [ ] 5.1 Create `scripts/billing/list-domain-events.ts` and `scripts/billing/requeue-domain-event.ts` for operator inspection and replay using the new repository/RPC seam.
- [ ] 5.2 Document the new operational flow in `docs/monetization/bridge-retry-contract.md` or a renamed successor doc, including event states, retry semantics, and replay procedure.
- [ ] 5.3 Add focused tests for the replay helpers or the underlying repository functions they call.

## 6. Remove HTTP bridge transport

- [ ] 6.1 Delete `src/routes/api/billing-bridge.ts` after all producers have migrated and no runtime path depends on HMAC bridge delivery.
- [ ] 6.2 Remove unused app bridge/HMAC transport code and env/docs references that only existed for the HTTP bridge.
- [ ] 6.3 Run `bun run typecheck`, focused billing suites in both repos, full `bun run test`, and `openspec validate replace-http-billing-bridge-with-db-outbox --strict --no-interactive`.
