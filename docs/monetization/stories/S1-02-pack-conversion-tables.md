# S1-02 · Pack & Conversion Tables Migration

## Goal

Create the tables that track purchased pack value and upgrade-conversion lifecycle: `pack_credit_lot`, `subscription_credit_conversion`, `subscription_credit_conversion_allocation`.

## Why

Upgrade-discount eligibility must be derived from real purchase provenance (`pack_credit_lot`), not inferred from `credit_balance`. The conversion tables manage the reservation/apply/release lifecycle when a pack user upgrades to unlimited. These must exist before conversion RPCs can be written.

## Depends on

- S1-01 (core tables — `account_billing` FK target)

## Blocks

- S1-04+ (RPCs that reference these tables)
- S1-12 (type regeneration)

## Scope

- One Supabase migration file creating:
  - `pack_credit_lot` with all columns, CHECK constraints, `UNIQUE(stripe_event_id)`, and partial index on open lots
  - `subscription_credit_conversion` with all columns, CHECK constraints, partial unique indexes (`pending` per account, `checkout_session_id`)
  - `subscription_credit_conversion_allocation` with composite PK and lot index
- RLS enabled on all three tables with deny-all policies

## Out of scope

- Core tables (S1-01)
- Event tables (S1-03)
- RPCs
- TypeScript code

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_billing_pack_conversion_tables.sql` |

## Constraints / decisions to honor

- At most one `pending` conversion per account (enforced by unique partial index)
- `pack_credit_lot.remaining_credits` must satisfy `0 <= remaining_credits <= original_credits`
- `subscription_credit_conversion.status` values: `pending`, `applied`, `released`, `reversed`
- FIFO lot consumption: `ORDER BY created_at ASC, id ASC`
- Operational/admin grants must never create `pack_credit_lot` rows

## Acceptance criteria

- [ ] Migration applies cleanly after S1-01
- [ ] Partial unique index on `subscription_credit_conversion` prevents two `pending` rows for the same account
- [ ] `pack_credit_lot.remaining_credits` CHECK constraint works
- [ ] FK references to `account(id)` cascade on delete
- [ ] RLS enabled; direct anon/authenticated access denied

## Verification

- `supabase db reset` with both migrations completes without errors
- Attempt to insert two `pending` conversions for one account fails

## Parallelization notes

- Can run in parallel with S1-03 (both depend only on S1-01)

## Suggested PR title

`feat(billing): pack credit lot and conversion tables`
