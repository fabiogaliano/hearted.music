# S2-04 · Queue-Band Implementation

## Goal

Replace the hardcoded `resolveQueuePriority()` stub with a real implementation that derives the queue band from `BillingState`.

## Why

All jobs currently get `low` priority. The existing infrastructure is wired (column, `bandToNumeric`, call site in `service.ts`) but the resolution function returns a constant. This story makes newly created jobs use the correct band.

## Depends on

- S2-01 (BillingState type, QueueBand)
- S2-02 (readBillingState — needed to fetch billing state for band resolution)

## Blocks

- Phase 3 (correct priority on billing-triggered work)

## Scope

- Update `resolveQueuePriority()` in `src/lib/workflows/library-processing/queue-priority.ts`
- Accept billing state (or account ID + supabase client) and return the correct `QueueBand`
- Mapping:
  - `yearly` plan + active subscription → `priority`
  - `self_hosted` unlimited → `priority`
  - `quarterly` plan + active subscription → `standard`
  - Non-unlimited account with positive `creditBalance` → `standard`
  - Everything else → `low`
- Update the call site in `service.ts` to pass billing state

## Out of scope

- Reprioritizing existing pending jobs (that's the SQL RPC from S1-10)
- Creating the BillingState type (S2-01)
- Reconciler changes (S2-05)

## Likely touchpoints

| Area | Files |
|---|---|
| Queue priority | `src/lib/workflows/library-processing/queue-priority.ts` |
| Service | `src/lib/workflows/library-processing/service.ts` (call site) |

## Constraints / decisions to honor

- Band mapping is frozen per DECISIONS.md
- `queue-priority.ts` remains a thin adapter — plan/offer mapping stays in billing domain
- Implementation boundary: billing domain derives the band from billing facts; queue-priority.ts is the scheduler-facing adapter only

## Acceptance criteria

- [ ] `resolveQueuePriority()` returns correct band for each billing state
- [ ] No longer returns constant `"low"`
- [ ] Call site in `service.ts` passes billing state correctly
- [ ] Project compiles and existing tests pass

## Verification

- Unit tests: all band mappings
- `bun run test` passes

## Parallelization notes

- Can run in parallel with S2-03, S2-05 after S2-01 and S2-02 merge
- Touches `queue-priority.ts` (unlikely to conflict with other Phase 2 work)

## Suggested PR title

`feat(billing): resolve queue priority from billing state`
