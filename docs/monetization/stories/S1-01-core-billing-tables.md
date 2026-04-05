# S1-01 · Core Billing Tables Migration

## Goal

Create the foundational billing tables (`account_billing`, `account_song_unlock`, `credit_transaction`) with constraints, indexes, and RLS policies.

## Why

Every billing feature depends on these three tables: `account_billing` holds per-account billing facts, `account_song_unlock` records per-song access, and `credit_transaction` provides the immutable balance ledger. Nothing else can land until these exist.

## Depends on

- None (first story in the chain)

## Blocks

- S1-02 (pack/conversion tables reference `account_billing`)
- S1-03 (event tables reference `account_billing`)
- All RPC stories (S1-04 through S1-11)
- S1-12 (type regeneration)

## Scope

- One Supabase migration file creating:
  - `account_billing` with all columns, CHECK constraints, and UNIQUE indexes per V2 plan schema
  - `account_song_unlock` with all columns, CHECK constraints, `UNIQUE(account_id, song_id)`, and `idx_account_song_unlock_account` index
  - `credit_transaction` with all columns, CHECK constraints, and `idx_credit_txn_account` index
- RLS enabled on all three tables with deny-all for anon/authenticated (service-role bypass)

## Out of scope

- Pack/conversion tables (S1-02)
- Event/idempotency tables (S1-03)
- RPCs (S1-04+)
- TypeScript types or domain module
- Account provisioning hooks

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_billing_core_tables.sql` |

## Constraints / decisions to honor

- Table names, column names, CHECK values, and index names from `MONETIZATION_V2_PLAN.md` § Schema are frozen
- RLS pattern: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` + deny-all policies matching existing repo convention
- `account_billing.credit_balance` default `0`, `plan` default `'free'`, `subscription_status` default `'none'`
- `account_song_unlock.UNIQUE(account_id, song_id)` prevents double-unlock
- `credit_transaction` is append-only by design; no UPDATE/DELETE policies needed beyond deny-all

## Acceptance criteria

- [ ] Migration applies cleanly on a fresh Supabase instance
- [ ] All CHECK constraints reject invalid values (tested via `INSERT` attempts)
- [ ] `UNIQUE` constraints prevent duplicate rows
- [ ] RLS enabled; direct `anon`/`authenticated` access denied
- [ ] `service_role` can read/write all three tables
- [ ] Foreign keys reference `account(id)` and `song(id)` with `ON DELETE CASCADE`

## Verification

- `supabase db reset` completes without errors
- Manual insert/select tests via `service_role` succeed
- Manual insert via `anon` role is denied

## Parallelization notes

- This story is serial — nothing else can start until it lands
- S1-02 and S1-03 can start immediately after this merges

## Suggested PR title

`feat(billing): core billing tables — account_billing, account_song_unlock, credit_transaction`
