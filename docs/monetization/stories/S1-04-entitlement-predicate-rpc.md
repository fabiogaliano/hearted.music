# S1-04 · Entitlement Predicate RPC

## Goal

Implement `is_account_song_entitled` — the single canonical SQL function that determines whether an account may access a song's paid value.

## Why

This predicate is used by selectors, content activation, and read models. Defining it once prevents entitlement semantics from drifting across consumers. It must exist before billing-aware selectors or unlock RPCs can be built.

## Depends on

- S1-01 (core tables: `account_billing`, `account_song_unlock`)

## Blocks

- S1-05 (unlock RPCs reference entitlement logic)
- S1-11 (selector RPCs depend on this predicate)
- Phase 3 (all entitlement enforcement)

## Scope

- One migration creating `is_account_song_entitled(p_account_id UUID, p_song_id UUID) RETURNS BOOLEAN`
- `SECURITY DEFINER` with `SET search_path = public`
- Logic: returns `true` when **either**:
  - `account_song_unlock` row exists with `revoked_at IS NULL` for this account + song
  - `account_billing.unlimited_access_source IS NOT NULL` and subscription lifecycle is valid (active status for `subscription` source; always valid for `self_hosted`)
- Tests for: unlocked song, locked song, revoked unlock, active unlimited, expired unlimited, self_hosted

## Out of scope

- Batch/set entitlement (callers iterate or use in subqueries)
- TypeScript wrappers
- Read-model integration

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_entitlement_predicate.sql` |

## Constraints / decisions to honor

- `past_due` and `unpaid` subscription statuses do NOT grant unlimited access for `subscription` source
- `self_hosted` grants access without Stripe state
- `unlimited_access_source IS NULL` → no unlimited access
- One canonical predicate — no per-consumer variants

## Acceptance criteria

- [ ] Returns `true` for a song with an active (non-revoked) unlock row
- [ ] Returns `false` for a song with a revoked unlock row and no unlimited access
- [ ] Returns `true` for any song when `unlimited_access_source = 'self_hosted'`
- [ ] Returns `true` for any song when `unlimited_access_source = 'subscription'` AND `subscription_status = 'active'`
- [ ] Returns `false` when `unlimited_access_source = 'subscription'` AND `subscription_status IN ('past_due', 'unpaid', 'canceled', 'none')`
- [ ] Function is `SECURITY DEFINER` with `search_path = public`

## Verification

- SQL test cases covering all combinations of unlock state × unlimited access state
- `supabase db reset` completes

## Parallelization notes

- Can start as soon as S1-01 merges
- Can run in parallel with S1-02, S1-03

## Suggested PR title

`feat(billing): is_account_song_entitled entitlement predicate RPC`
