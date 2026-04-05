# S3-06 · Reconciler Billing-Change Handling

## Goal

Update the reconciler and service to handle the three billing change variants: `songs_unlocked`, `unlimited_activated`, `candidate_access_revoked`.

## Why

The control plane must react to billing events to schedule enrichment work and refresh match snapshots. Without reconciler support, billing-triggered changes would be silently ignored.

## Depends on

- S2-05 (change variants defined in types.ts)
- S2-04 (queue-band resolution for newly created jobs)

## Blocks

- Phase 4 (bridge handlers emit these changes)
- Phase 5 (free allocation emits `songs_unlocked`)

## Scope

- Update `src/lib/workflows/library-processing/reconciler.ts`:
  - `songs_unlocked` → ensure enrichment work exists for the unlocked songs; ensure match refresh if new candidates available
  - `unlimited_activated` → trigger full-library enrichment scheduling; ensure match refresh
  - `candidate_access_revoked` → trigger match snapshot refresh only (candidate set shrank)

- Update `src/lib/workflows/library-processing/service.ts`:
  - `applyLibraryProcessingChange` handles new change kinds
  - Routes to reconciler with correct context

## Out of scope

- Bridge endpoint that emits these changes (Phase 4)
- Enrichment orchestrator changes (S3-01–S3-04)
- UI

## Likely touchpoints

| Area | Files |
|---|---|
| Reconciler | `src/lib/workflows/library-processing/reconciler.ts` |
| Service | `src/lib/workflows/library-processing/service.ts` |

## Constraints / decisions to honor

- Control plane stays pricing-neutral — no refund/Stripe references
- `candidate_access_revoked` triggers match snapshot refresh only, not enrichment
- `unlimited_activated` is account-wide; the reconciler should ensure enrichment for all liked songs (similar to how sync/onboarding ensures work)
- Queue priority for new jobs comes from `resolveQueuePriority()`

## Acceptance criteria

- [ ] `songs_unlocked` creates enrichment jobs for specified songs
- [ ] `unlimited_activated` schedules full-library enrichment
- [ ] `candidate_access_revoked` triggers match snapshot refresh
- [ ] No Stripe-specific logic in reconciler
- [ ] Queue priority applied correctly from billing state
- [ ] Project compiles and existing reconciler tests pass

## Verification

- Unit tests for each change variant
- `bun run test` passes

## Parallelization notes

- Touches `reconciler.ts` and `service.ts` — coordinate with S3-01 if that also modifies `service.ts`
- Can run in parallel with read-model stories (S3-07+) and S3-05

## Suggested PR title

`feat(billing): reconciler handling for billing change variants`
