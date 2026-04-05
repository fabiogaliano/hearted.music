# S7-05 · Queue Reprioritization Audit + Fresh-Account Bootstrap Validation

## Goal

Verify every billing mutation that changes queue band correctly invokes `reprioritize_pending_jobs_for_account`, and validate fresh-account bootstrap in both provider modes.

## Why

A missed reprioritization call leaves pending jobs at a stale priority, silently degrading throughput or wasting resources. Fresh-account bootstrap validates the real first-user experience without test-data masking.

## Depends on

- Phases 1–6 complete

## Blocks

- None

## Scope

### Reprioritization audit
- Enumerate every billing mutation that can change the resolved queue band
- Verify each calls `reprioritize_pending_jobs_for_account` as its final step:
  - `fulfill_pack_purchase` (free → pack: low → standard)
  - `activate_subscription` (→ standard or priority)
  - `update_subscription_state` (past_due recovery, etc.)
  - `deactivate_subscription` (unlimited → free/pack)
  - `reverse_pack_entitlement` (balance change)
  - App-layer `self_hosted` provisioning
- Test each transition: verify pending jobs get the correct band after each mutation

### Fresh-account bootstrap
- Empty account (no seeded data) in provider-enabled mode: signup → onboarding → first purchase → results
- Empty account in provider-disabled mode: signup → onboarding → full processing
- Verify billing row creation, provisioning, and complete lifecycle

## Out of scope

- Happy-path flow testing (S7-01–S7-03)
- Concurrency (S7-04)

## Likely touchpoints

| Area | Files |
|---|---|
| Tests | `tests/` |
| All billing RPCs containing reprioritize calls |
| Account provisioning |

## Constraints / decisions to honor

- Band mapping is frozen; every mutation must leave jobs at the correct post-mutation band
- Refund flows with multiple mutations must leave jobs at the final post-refund band

## Acceptance criteria

- [ ] Every queue-band-affecting mutation calls `reprioritize_pending_jobs_for_account`
- [ ] Pending job priority correct after each tested transition
- [ ] Fresh empty account completes onboarding in provider-enabled mode
- [ ] Fresh empty account completes onboarding in provider-disabled mode
- [ ] No bootstrap assumptions relying on seeded data

## Verification

- SQL-level tests for each reprioritization path
- Manual fresh-account walkthrough in both modes

## Parallelization notes

- Can run in parallel with S7-01 through S7-04

## Suggested PR title

`test(billing): queue reprioritization audit and fresh-account bootstrap validation`
