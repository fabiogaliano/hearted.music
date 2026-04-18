# S2-05 · Control-Plane Change Variants + BillingChanges Helpers

## Goal

Add billing-triggered change variants to `LibraryProcessingChange` and create the `BillingChanges.*` helper group.

## Why

The control plane must react to billing events (songs unlocked, unlimited activated, access revoked) through the same typed change contract used for sync, onboarding, and worker outcomes. Defining these now freezes the interface before Phase 3 wires the reconciler and bridge handlers.

## Depends on

- S2-01 (billing domain types)

## Blocks

- Phase 3 (reconciler handles these change variants)
- Phase 4 (bridge handlers emit these changes)

## Scope

### New change variants in `LibraryProcessingChange`
```ts
| { kind: "songs_unlocked"; accountId: string; songIds: string[] }
| { kind: "unlimited_activated"; accountId: string }
| { kind: "candidate_access_revoked"; accountId: string }
```

### `src/lib/workflows/library-processing/changes/billing.ts`
- `BillingChanges.songsUnlocked(accountId, songIds)` — returns `songs_unlocked` change
- `BillingChanges.unlimitedActivated(accountId)` — returns `unlimited_activated` change
- `BillingChanges.candidateAccessRevoked(accountId)` — returns `candidate_access_revoked` change

### Bridge event payload types
- Define stable typed shapes for the three billing bridge call payloads (pack fulfillment, unlimited activation, revocation outcome)
- These types will be consumed by the bridge ingress handler in Phase 4

## Out of scope

- Reconciler logic for handling these changes (Phase 3 — S3-06)
- Bridge HTTP endpoint (Phase 4)
- `applyLibraryProcessingChange` integration (Phase 3)

## Likely touchpoints

| Area | Files |
|---|---|
| Control-plane types | `src/lib/workflows/library-processing/types.ts` |
| Change helpers | `src/lib/workflows/library-processing/changes/billing.ts` *(new)* |
| Bridge types | `src/lib/domains/billing/bridge-events.ts` *(new)* or similar |

## Constraints / decisions to honor

- Change kind names are frozen: `songs_unlocked`, `unlimited_activated`, `candidate_access_revoked`
- The control plane never learns *why* access changed, only *that* it changed
- `songs_unlocked` carries song IDs; `unlimited_activated` is account-wide; `candidate_access_revoked` does not carry song IDs or refund reasons
- If `library-processing` code references refunds, chargebacks, or Stripe IDs, the boundary has been crossed

## Acceptance criteria

- [ ] `LibraryProcessingChange` union includes all three billing variants
- [ ] `BillingChanges.*` helpers return correctly typed change objects
- [ ] Bridge event payload types are exported and typed
- [ ] No Stripe-specific types leak into `library-processing` code
- [ ] Project compiles

## Verification

- `tsc --noEmit` passes
- Existing tests pass (no runtime impact — these are additive types)

## Parallelization notes

- Can run in parallel with S2-02, S2-03, S2-04 after S2-01 merges
- Touches `types.ts` in library-processing — coordinate with S2-04 if both modify the same file

## Suggested PR title

`feat(billing): control-plane billing change variants and BillingChanges helpers`
