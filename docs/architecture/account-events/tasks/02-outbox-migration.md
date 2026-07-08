---
status: proposed
updated: 2026-07-08
depends_on: []
---

# 02 — `account_event` outbox migration

Create the durable outbox table, publish sequence, and indexes from
proposal.md §5.1. Pure schema work — no triggers, no producers yet.

## Steps

- [ ] New Supabase migration: `CREATE SEQUENCE public.account_event_publish_seq`
- [ ] `CREATE TABLE public.account_event` exactly per proposal §5.1
      (`id BIGSERIAL`, nullable `publish_id BIGINT UNIQUE`, `account_id` FK with
      `ON DELETE CASCADE`, `type`, `payload JSONB`, `created_at`, `published_at`)
- [ ] Partial index `(account_id, publish_id) WHERE publish_id IS NOT NULL`
      (replay path)
- [ ] Partial index `(id) WHERE publish_id IS NULL` (publisher claim path)
- [ ] Enable RLS with **no** policies — the table is reached only via direct
      worker/app connections, never PostgREST
- [ ] Comment on table: `id` is insertion identity, `publish_id` is the only
      replay cursor; unpublished rows must never be pruned

## Acceptance gate

- [ ] Migration applies cleanly on a fresh local reset (`supabase db reset` or
      project equivalent) and is idempotent-safe alongside existing migrations
- [ ] Table, sequence, and both partial indexes exist with the contract shapes
- [ ] RLS is enabled and an anon/authenticated PostgREST read returns nothing

## Guardrails

- No `pg_notify` trigger on this table — producers NOTIFY explicitly in their
  own transactions (task 03), keeping the wake path in app code.
- Do not add retention/pruning here; retention is an operational follow-up and
  must exclude `publish_id IS NULL` rows.
- `id` must never leak into any API as a cursor.
