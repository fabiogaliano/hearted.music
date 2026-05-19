## Context

Today `../v1_hearted_brand/` mutates billing state through Supabase RPCs, then sends an HTTP request to `src/routes/api/billing-bridge.ts`, which validates a duplicated payload schema and dispatches `handlePackFulfilled`, `handleUnlimitedActivated`, `handlePackReversed`, `handleUnlimitedPeriodReversed`, or `handleSubscriptionDeactivated`.

Relevant current files:

- App receiver: `src/routes/api/billing-bridge.ts`
- App handlers: `src/lib/domains/billing/bridge-handlers.ts`
- App idempotency table/RPCs: `supabase/migrations/20260420000000_billing_bridge_event_status_lease.sql`
- Billing-service sender: `../v1_hearted_brand/src/lib/bridge.ts`
- Billing-service webhook handlers:
  - `../v1_hearted_brand/src/handlers/checkout-completed.ts`
  - `../v1_hearted_brand/src/handlers/refund.ts`
  - `../v1_hearted_brand/src/handlers/subscription.ts`
- Billing-service webhook ingress: `../v1_hearted_brand/src/routes/webhooks.ts`

That shape creates three different failure windows:

1. the billing mutation succeeds but the HTTP bridge call fails or becomes schema-incompatible;
2. the app accepts/claims the bridge row but crashes before finishing control-plane invalidation;
3. the billing-service webhook handler marks internal failure but still returns `200` to Stripe, so Stripe never retries the source event.

The new architecture moves the delivery contract into the shared DB. The billing-service still decides *which* business event happened, but the database becomes the durable handoff boundary between billing mutation and app-side control-plane work.

## Goals / Non-Goals

**Goals**

- Make billing-originated control-plane events durable before the billing-service webhook handler returns success.
- Ensure the billing mutation and event enqueue happen in the same database transaction.
- Version event payloads explicitly so consumers can upcast older rows.
- Reuse the existing app worker process for billing event consumption.
- Provide operator replay tooling without requiring ad-hoc SQL edits.
- Migrate off the HTTP billing bridge entirely once all event kinds use the DB outbox.

**Non-Goals**

- Moving Stripe webhook ingestion into the app repo.
- Replacing Supabase with a separate message broker.
- Building a human-facing admin UI in this change.
- Redesigning `BillingChanges.*` semantics or library-processing reconciliation.
- Guaranteeing cross-repo code sharing through a new package in this change; the DB envelope is the shared contract.

## Decisions

### 1. Table name and envelope shape: `billing_domain_event`

**Decision:** Add a new table `billing_domain_event` in the shared app schema.

Minimum columns:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `stripe_event_id TEXT NOT NULL`
- `event_kind TEXT NOT NULL`
- `schema_version INTEGER NOT NULL`
- `payload JSONB NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'processed', 'failed'))`
- `attempt_count INTEGER NOT NULL DEFAULT 0`
- `available_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `processing_started_at TIMESTAMPTZ`
- `processed_at TIMESTAMPTZ`
- `last_error TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Constraints/indexes:

- `UNIQUE (stripe_event_id, event_kind)` for dedupe at the domain-event level.
- index on `(status, available_at)` for polling.
- index on `(event_kind, created_at)` for operator inspection.

`payload` carries event-kind-specific data such as `account_id`, `pack_stripe_event_id`, `subscription_period_end`, and `access_removed`. `stripe_event_id` and `event_kind` stay in first-class columns for efficient dedupe/filtering instead of forcing JSON extraction.

**Rationale:** `billing_domain_event` names the business concept, not the transport trick. This table is both an outbox (written by billing mutations) and an inbox (consumed by the app worker), so a neutral domain term ages better than `billing_bridge_event` or `billing_outbox_event`.

### 2. Version the envelope explicitly with integer `schema_version`

**Decision:** Every row stores `event_kind`, `schema_version`, and `payload`. The app consumer reads rows through per-kind parser/upcaster modules under `src/lib/domains/billing/events/`.

Rules:

- V1 starts at `schema_version = 1` for each event kind.
- The worker upcasts older payloads to one current in-memory shape before dispatch.
- Upcasters are append-only; adding v2 does not rewrite old rows.
- Unknown future versions are retryable failures recorded on the event row, not terminal silent drops.

**Rationale:** versioning moves compatibility policy into one durable place. Unlike the HTTP bridge, a deploy that introduces a new payload shape no longer relies on both repos deploying simultaneously.

### 3. Canonical event kinds and v1 payloads are explicit

**Decision:** The DB outbox contract keeps the existing business event kinds and defines one canonical v1 payload per kind.

Canonical event kinds:

- `pack_fulfilled`
- `unlimited_activated`
- `pack_reversed`
- `unlimited_period_reversed`
- `subscription_deactivated`

V1 payload requirements:

- `pack_fulfilled`
  - `account_id: uuid`
  - `bonus_unlocked_song_ids: uuid[]`
- `unlimited_activated`
  - `account_id: uuid`
  - `stripe_subscription_id: string`
  - `subscription_period_end: string`
- `pack_reversed`
  - `account_id: uuid`
  - `pack_stripe_event_id: string`
  - `reason: "refund" | "chargeback"`
  - `access_removed: boolean`
- `unlimited_period_reversed`
  - `account_id: uuid`
  - `stripe_subscription_id: string`
  - `subscription_period_end: string`
  - `reason: "refund" | "chargeback"`
  - `access_removed: boolean`
- `subscription_deactivated`
  - `account_id: uuid`

Envelope ownership rules:

- `stripe_event_id`, `event_kind`, and `schema_version` live in first-class columns, not inside `payload`.
- `payload` must contain only kind-specific business fields.
- the app consumer must parse from DB rows into one normalized in-memory event union before dispatch.

**Rationale:** the outbox removes transport drift only if the business contract itself is explicit. Free-form JSON payloads would recreate the same ambiguity in a different place.

### 4. Same-transaction enqueue must live inside SQL orchestration functions

**Decision:** The billing-service SHALL stop doing "mutate, then insert/send" from TypeScript for billing→app control-plane events. Instead, it SHALL call SQL orchestration functions that both apply the billing mutation and insert `billing_domain_event` in the same transaction.

Planned orchestration seams:

- pack fulfillment: wrap `fulfill_pack_purchase(...)` + enqueue `pack_fulfilled`
- pack refund/chargeback reversal: wrap `reverse_pack_entitlement(...)` + enqueue `pack_reversed`
- unlimited activation: wrap `activate_subscription(...)` + enqueue `unlimited_activated`
- unlimited period reversal: wrap `reverse_unlimited_period_entitlement(...)` + `deactivate_subscription(...)` + enqueue `unlimited_period_reversed`
- subscription deletion: wrap `deactivate_subscription(...)` + enqueue `subscription_deactivated`

The billing-service may still do prerequisite Stripe reads in TypeScript (e.g. retrieve subscription period end), but once it has the concrete DB inputs it makes one service-role RPC call per domain mutation path.

**Rationale:** Supabase JS cannot guarantee a single transaction across multiple RPC and insert round-trips. The only durable place to couple mutation + outbox write is the SQL boundary.

### 5. Reuse the app worker with a dedicated billing event loop

**Decision:** Add a dedicated billing-domain-event poll loop to the existing worker process rather than a separate daemon.

Planned files:

- `src/worker/billing-domain-events.ts` — poll/claim/process/finalize loop
- `src/lib/domains/billing/events/repository.ts` — typed wrappers for claim/finalize/requeue RPCs
- `src/lib/domains/billing/events/schema.ts` — Zod schemas/upcasters
- `src/lib/domains/billing/events/dispatch.ts` — maps current event shapes to `BillingChanges.*`

Runtime behavior:

- default poll interval: `5_000ms` via `workerConfig.billingEventPollIntervalMs`
- batch size: 20 rows per tick
- processing lease: `5 minutes`
- exponential retry backoff written into `available_at`
- max automatic attempts: 8, then status becomes `failed`

This loop runs alongside existing enrichment and walkthrough-preview polling. Shutdown/drain wiring should treat a claimed billing event like any other active unit of worker work.

**Rationale:** the app already has a durable worker process with health, sweeping, and draining. Billing event delivery is background control-plane work and fits that runtime better than an HTTP route.

### 6. Claim/finalize/retry stays DB-driven, not in-memory

**Decision:** Add claim/finalization RPCs for `billing_domain_event`, modeled after the existing lease-based `billing_bridge_event` flow but keyed by the new event table.

Required operations:

- `claim_billing_domain_events(p_limit INTEGER, p_lease_ms INTEGER)` → returns a batch of rows transitioned to `processing`
- `mark_billing_domain_event_processed(p_event_id UUID)`
- `mark_billing_domain_event_retryable_failure(p_event_id UUID, p_available_at TIMESTAMPTZ, p_error TEXT)`
- `mark_billing_domain_event_failed(p_event_id UUID, p_error TEXT)`
- `requeue_billing_domain_event(p_event_id UUID)`

Rules:

- claims use `FOR UPDATE SKIP LOCKED` or equivalent CAS semantics so concurrent workers never process the same row simultaneously;
- retryable failures increment `attempt_count`, clear the lease, store `last_error`, and push `available_at` into the future;
- terminal failure stores `status='failed'` without deleting the row;
- operator requeue resets `status='pending'`, `attempt_count=0`, clears `processing_started_at`, `processed_at`, and `last_error`, and sets `available_at=now()` while leaving `created_at` unchanged.

**Rationale:** durable retry metadata belongs with the event row, not in worker memory or Stripe delivery assumptions.

### 6. Billing webhook idempotency must become reclaimable

**Decision:** `billing_webhook_event` can no longer use insert-only `claimWebhookEvent(...)` semantics once the route starts returning retryable non-2xx for pre-enqueue failures. The billing-service SHALL move webhook ingress idempotency to the same reclaimable state-machine shape already used by app-side bridge events.

Required behavior:

- a newly received Stripe event claims a `billing_webhook_event` row into `status='processing'`;
- a successfully completed billing mutation + outbox enqueue marks the row `processed`;
- a pre-enqueue failure marks the row `failed` with error context;
- a later Stripe retry for the same `stripe_event_id` can reclaim a `failed` row or a stale `processing` row and try again;
- a duplicate delivery for an already `processed` row returns a terminal success/no-op response.

Implementation direction:

- keep `billing_webhook_event` as the billing-service ingress idempotency table;
- replace `claimWebhookEvent(...)` with service-role RPCs such as `claim_billing_webhook_event(...)`, `mark_billing_webhook_event_processed(...)`, and `mark_billing_webhook_event_failed(...)`;
- use a processing lease or equivalent stale-processing timeout so worker/process crashes do not wedge a Stripe event forever.

**Rationale:** returning `500` is not enough if the next Stripe delivery will be dropped by an insert-only idempotency claim. Reclaimable webhook rows are the missing half of durable source recovery.

### 7. Webhook success means mutation + enqueue succeeded

**Decision:** `../v1_hearted_brand/src/routes/webhooks.ts` SHALL stop returning success unconditionally after a claimed event. Handlers should surface an explicit success/failure result so the route can return `500` when the billing mutation or outbox enqueue fails.

Rules:

- app-consumer failure after enqueue does **not** affect Stripe ack; the row is already durable and will retry internally;
- pre-enqueue failures (Stripe lookup error, RPC failure, schema violation, DB outage) return retryable non-2xx so Stripe can redeliver;
- webhook retries MUST flow through the reclaimable `billing_webhook_event` state machine instead of the current insert-only claim helper.

**Rationale:** moving app fan-out to a DB outbox removes dependence on Stripe retry for internal delivery, but Stripe retry is still the correct recovery path when the source mutation itself never completed.

### 8. Replay tooling is scripts + RPCs, not an admin UI

**Decision:** Provide operator tooling as service-role scripts under `scripts/billing/` backed by replay RPCs, not a product surface.

Planned tooling:

- `scripts/billing/list-domain-events.ts` — filters by `status`, `event_kind`, `stripe_event_id`, date range
- `scripts/billing/requeue-domain-event.ts --id <uuid>`
- optional `scripts/billing/show-domain-event.ts --id <uuid>` for payload/error inspection

These scripts call typed helpers in `src/lib/domains/billing/events/repository.ts` or dedicated RPCs. They should be the documented mechanism for replay rather than manual SQL updates.

**Rationale:** the need is operational recovery, not end-user interaction. Scripts are enough for v1 and keep scope bounded.

### 9. Migrate event kinds in slices, then remove HTTP bridge

**Decision:** Roll out by event family instead of dual-writing every path.

Sequence:

1. ship schema + worker consumer idle path + replay tooling;
2. migrate `pack_reversed` and `unlimited_period_reversed` first;
3. migrate `pack_fulfilled`, `unlimited_activated`, and `subscription_deactivated`;
4. remove `../v1_hearted_brand/src/lib/bridge.ts`, `src/routes/api/billing-bridge.ts`, and HMAC bridge docs/config once no producers remain.

During the overlap window, HTTP bridge and DB outbox may coexist, but a given event kind/path must use exactly one transport to avoid duplicate `BillingChanges` application.

**Rationale:** reversal events are the highest-risk transport because they already proved schema drift can break correctness.

## Risks / Trade-offs

- **More shared-DB coupling** — accepted. The billing-service already relies on shared Supabase schema and service-role RPCs for the billing source of truth.
- **Polling adds a few seconds of propagation latency** — accepted. Billing-driven invalidation is not an interactive click-path, and durability is more important than subsecond delivery.
- **SQL orchestration functions become broader** — accepted. Transactional correctness belongs at the SQL boundary when multiple writes must succeed or fail together.
- **New operational table to monitor** — mitigated with scripts and explicit retry metadata.

## Migration Plan

1. Add `billing_domain_event` schema, indexes, triggers, and replay/claim/finalize RPCs in `supabase/migrations/`.
2. Regenerate `src/lib/data/database.types.ts`.
3. Add app-side event schemas, upcasters, dispatch module, and worker loop; keep it idle until rows exist.
4. Add scripts for listing and requeueing events.
5. Introduce billing-service handler result types so `src/routes/webhooks.ts` can return `500` on mutation/enqueue failure.
6. Migrate refund reversal flows to orchestration RPCs + outbox rows; remove HTTP bridge send from those paths.
7. Migrate fulfillment, activation, and deactivation flows.
8. Delete the HTTP bridge route/client/HMAC transport once all producers are migrated.
9. Update docs (`docs/monetization/bridge-retry-contract.md` or successor docs) to describe the DB outbox flow instead of HTTP retry semantics.
10. Run focused tests, `bun run typecheck`, full `bun run test`, and `openspec validate replace-http-billing-bridge-with-db-outbox --strict --no-interactive`.

## Rollback

Rollback path is transport fallback, not data deletion:

- keep `billing_domain_event` table additive;
- if a migrated event kind misbehaves, switch that producer path back to the existing HTTP bridge temporarily;
- leave the worker consumer disabled for that path until fixed;
- only remove the HTTP bridge after all migrated paths are stable.

Because the schema change is additive and event rows are append-only, rollback is operationally safe without destructive DB changes.
