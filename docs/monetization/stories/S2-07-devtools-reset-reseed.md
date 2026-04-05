# S2-07 · Devtools Reset/Reseed for Billing

## Goal

Update reset, reseed, and reset-onboarding scripts to handle billing tables so dev workflows remain consistent.

## Why

Adding billing tables without updating reset paths causes incomplete resets. Developers will end up with stale billing state that masks real bugs.

## Depends on

- S2-01 (env config)
- S2-03 (account provisioning — reseed must match provisioning behavior)
- S1-01 through S1-03 (billing tables exist)

## Blocks

- None directly; but dev workflows are broken without this

## Scope

- **`reset.ts`** (`src/lib/workflows/library-processing/devtools/reset.ts`)
  - Clear `account_billing` (or reset to defaults), `account_song_unlock`, `credit_transaction`, `pack_credit_lot`, `subscription_credit_conversion`, `subscription_credit_conversion_allocation`, `billing_webhook_event`, `billing_activation`, `billing_bridge_event`
  - Preserve the `account_billing` row but reset to default state

- **`reseed.ts`** (`src/lib/workflows/library-processing/devtools/reseed.ts`)
  - Seed `account_billing` row with appropriate state (free or self_hosted depending on `BILLING_ENABLED`)
  - Optionally seed test unlock rows or credit balance as explicit test data

- **`scripts/reset-onboarding.ts`**
  - Reset billing state alongside onboarding state
  - Clear unlock rows and reset balance

## Out of scope

- Production migration scripts
- Test fixture factories (created per-test as needed)

## Likely touchpoints

| Area | Files |
|---|---|
| Devtools | `src/lib/workflows/library-processing/devtools/reset.ts`, `reseed.ts` |
| Scripts | `scripts/reset-onboarding.ts` |

## Constraints / decisions to honor

- Seeded test data must not imply launch behavior
- If test accounts need purchased balance, grant explicitly as test data
- Prefer reset/reseed over historical backfill logic
- Keep test-account bootstrap separate from real product semantics

## Acceptance criteria

- [ ] `warmReplayReset()` clears all billing tables and leaves billing state consistent
- [ ] Reseed creates valid `account_billing` rows matching current `BILLING_ENABLED` setting
- [ ] `reset-onboarding.ts` resets billing alongside onboarding
- [ ] After reset + reseed, a dev account can go through onboarding without billing errors
- [ ] No orphaned billing rows after reset

## Verification

- Manual: run reset, reseed, verify billing state
- `bun run test` passes

## Parallelization notes

- Can start after S2-03 merges
- Touches devtools files that are unlikely to conflict with other Phase 2 work

## Suggested PR title

`chore(billing): update devtools reset/reseed for billing tables`
