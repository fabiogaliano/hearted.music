# S1-10 · Queue Reprioritization RPC

## Goal

Implement `reprioritize_pending_jobs_for_account` — the RPC that updates queue priority on all pending jobs when billing state changes.

## Why

Every billing mutation that can change the queue band must reprioritize pending jobs. Centralizing this in one RPC ensures the mapping logic lives in one place and is called consistently by all billing RPCs.

## Depends on

- S1-01 (core tables — `account_billing` for band resolution, `job` table for updates)

## Blocks

- S1-06, S1-07 (these RPCs call reprioritize as their final step)
- Phase 2 (app-layer `self_hosted` provisioning calls this after billing write)

## Scope

- One RPC: `reprioritize_pending_jobs_for_account(p_account_id UUID) RETURNS INTEGER`
- Resolves queue band from current `account_billing` state:
  - `yearly` plan with active subscription → `priority`
  - `self_hosted` unlimited access → `priority`
  - `quarterly` plan with active subscription → `standard`
  - Any non-unlimited account with positive `credit_balance` → `standard`
  - Everything else → `low`
- Updates `queue_priority` on all `status = 'pending'` jobs (both enrichment and match_snapshot_refresh)
- Uses `bandToNumeric` equivalent mapping (existing repo: `low=0, standard=1, priority=2`)
- No-ops if no pending jobs exist
- Does NOT affect `claimed` or `running` jobs
- Returns number of jobs updated
- `SECURITY DEFINER`, `SET search_path = public`

## Out of scope

- TypeScript `resolveQueuePriority()` (Phase 2 — S2-04)
- Calling this from app-layer provisioning (Phase 2 — S2-03)
- Wiring it into enrichment job creation (Phase 2)

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_reprioritize_pending_jobs_rpc.sql` |

## Constraints / decisions to honor

- Band mapping is frozen: free(no balance)→low, positive balance→standard, quarterly→standard, yearly→priority, self_hosted→priority
- Must resolve band internally from billing state, not accept a priority parameter
- Numeric mapping: `low=0, standard=1, priority=2` (matches existing `bandToNumeric`)
- Must be callable from other RPCs (used as final step in billing RPCs)

## Acceptance criteria

- [ ] Correctly maps each billing state to the right band
- [ ] Updates all `status = 'pending'` jobs for the account
- [ ] Does not affect `claimed` or `running` jobs
- [ ] Returns correct count of updated jobs
- [ ] No-op when no pending jobs exist (returns 0)
- [ ] Band mapping matches frozen decisions

## Verification

- SQL tests: free→pack transition, pack→unlimited, unlimited→deactivated, self_hosted
- `supabase db reset` completes

## Parallelization notes

- Can start as soon as S1-01 merges
- Other RPC stories can initially stub the call to this RPC if it's not yet merged

## Suggested PR title

`feat(billing): reprioritize_pending_jobs_for_account RPC`
