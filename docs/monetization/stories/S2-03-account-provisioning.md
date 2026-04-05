# S2-03 · Account Provisioning + Self-Hosted Unlimited Access

## Goal

Ensure every new account gets an `account_billing` row at creation time, with `self_hosted` unlimited access provisioned when `BILLING_ENABLED=false`.

## Why

Missing `account_billing` rows are an invariant violation. Provider-disabled deployments must grant explicit `self_hosted` unlimited access so the canonical entitlement predicate works without SQL bypass or mode inference.

## Depends on

- S2-01 (env config for `BILLING_ENABLED`)
- S1-12 (generated types)

## Blocks

- Phase 3 (entitlement enforcement assumes billing row exists)
- S2-07 (devtools reset/reseed must be consistent with provisioning)

## Scope

- Update `createAccountForBetterAuthUser()` in `src/lib/domains/library/accounts/queries.ts` to also insert an `account_billing` row
- When `BILLING_ENABLED=false`: set `unlimited_access_source = 'self_hosted'` on the new billing row
- When `BILLING_ENABLED=true`: create billing row with defaults (`plan='free'`, `credit_balance=0`, `unlimited_access_source=NULL`)
- Idempotent: `INSERT ... ON CONFLICT DO NOTHING`
- After billing write in provider-disabled mode, call `reprioritize_pending_jobs_for_account` (via Supabase RPC) so any already-pending jobs get `priority` band

## Out of scope

- Better Auth hook changes (if the hook already calls `createAccountForBetterAuthUser`, no hook change needed)
- Self-healing in `getBillingState` (S2-02 handles that as a safety net)
- UI changes

## Likely touchpoints

| Area | Files |
|---|---|
| Account provisioning | `src/lib/domains/library/accounts/queries.ts` |
| Env | `src/env.ts` (reading `BILLING_ENABLED`) |

## Constraints / decisions to honor

- Missing `account_billing` row is an invariant violation, not a valid mode signal
- `self_hosted` is orthogonal to `plan` — those accounts keep `plan='free'` and `credit_balance=0`
- SQL never infers deployment mode from missing rows
- Provisioning must be idempotent

## Acceptance criteria

- [ ] New account creation always produces an `account_billing` row
- [ ] `BILLING_ENABLED=false` → `unlimited_access_source = 'self_hosted'`
- [ ] `BILLING_ENABLED=true` → `unlimited_access_source = NULL`, `plan = 'free'`
- [ ] Duplicate account creation does not fail or create duplicate billing rows
- [ ] `reprioritize_pending_jobs_for_account` called after self_hosted provisioning
- [ ] Project compiles and existing account creation tests pass

## Verification

- Test: create account with `BILLING_ENABLED=false` → verify billing row with `self_hosted`
- Test: create account with `BILLING_ENABLED=true` → verify billing row with defaults
- `bun run test` passes

## Parallelization notes

- Can run in parallel with S2-02, S2-04, S2-05 after S2-01 merges
- Touches `queries.ts` which other stories don't modify

## Suggested PR title

`feat(billing): provision account_billing row on account creation`
