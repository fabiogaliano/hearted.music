# S1-03 · Event/Idempotency Tables + Measurement Columns

## Goal

Create the idempotency and event-tracking tables (`billing_webhook_event`, `billing_activation`, `billing_bridge_event`) and add measurement columns to `song_analysis`.

## Why

Webhook and bridge idempotency are prerequisites for safe Stripe integration. `billing_activation` provides durable orchestration markers. The `song_analysis` measurement columns enable COGS visibility without affecting billing logic.

## Depends on

- S1-01 (core tables — `account(id)` FK target via `billing_bridge_event`)

## Blocks

- S1-12 (type regeneration)
- Phase 4 billing service stories (webhook/bridge handlers reference these tables)

## Scope

- One Supabase migration file creating:
  - `billing_webhook_event` with `stripe_event_id` PK, status CHECK, indexes
  - `billing_activation` with kind CHECK, unique constraint on `(account_id, kind, stripe_subscription_id, subscription_period_end)`
  - `billing_bridge_event` with `stripe_event_id` PK, `event_kind` CHECK
- RLS enabled on all three tables with deny-all policies
- Separate `ALTER TABLE song_analysis` adding: `provider TEXT`, `input_tokens INTEGER`, `output_tokens INTEGER`, `cost_usd NUMERIC(10, 8)` (all nullable, `IF NOT EXISTS`)

## Out of scope

- Core or pack/conversion tables
- RPCs
- Populating the new measurement columns (that happens in enrichment stage changes)

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_billing_event_tables_and_measurement_cols.sql` |

## Constraints / decisions to honor

- `billing_webhook_event.status` values: `processing`, `processed`, `failed`
- `billing_activation.kind` values: `unlimited_period_activated`
- `billing_activation` NOT NULL on `stripe_subscription_id` and `subscription_period_end` (PostgreSQL NULL-distinctness in UNIQUE)
- `billing_bridge_event.event_kind` values: `pack_fulfilled`, `unlimited_activated`, `pack_reversed`, `unlimited_period_reversed`, `subscription_deactivated`
- `song_analysis` measurement columns are for operational COGS only; billing must never depend on them

## Acceptance criteria

- [ ] Migration applies cleanly after S1-01
- [ ] `billing_webhook_event` rejects duplicate `stripe_event_id` inserts
- [ ] `billing_activation` unique constraint prevents duplicate activation markers
- [ ] `billing_bridge_event` rejects duplicate `stripe_event_id` inserts
- [ ] `song_analysis` measurement columns are nullable and don't break existing writes
- [ ] RLS enabled on event tables

## Verification

- `supabase db reset` completes
- Existing `song_analysis` data unaffected by new columns

## Parallelization notes

- Can run in parallel with S1-02 (both depend only on S1-01)

## Suggested PR title

`feat(billing): event/idempotency tables + song_analysis measurement columns`
