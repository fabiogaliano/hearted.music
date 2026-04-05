# S4-09 · Bridge Handlers (Pack, Unlimited, Revocation)

## Goal

Implement the three bridge event handlers in `v1_hearted/` that translate billing-service outcomes into control-plane changes.

## Why

The bridge ingress (S4-08) dispatches events; this story implements the actual handling logic that emits `BillingChanges.*` and drives the control plane.

## Depends on

- S4-08 (bridge ingress dispatches to these handlers)
- S2-05 (`BillingChanges.*` helpers)
- S3-06 (reconciler handles billing change variants)
- S1-03 (`billing_activation` table)

## Blocks

- Phase 5 and 6 (depend on bridge delivering billing events to the app)

## Scope

### Pack fulfillment handler (`pack_fulfilled`)
- Receives `{ account_id, bonus_unlocked_song_ids, stripe_event_id }`
- Emits `BillingChanges.songsUnlocked(accountId, bonusUnlockedSongIds)` if any bonus songs
- Calls `applyLibraryProcessingChange`

### Unlimited activation handler (`unlimited_activated`)
- Receives `{ account_id, stripe_subscription_id, subscription_period_end, stripe_event_id }`
- Inserts `billing_activation` marker (idempotent: unique constraint)
- Emits `BillingChanges.unlimitedActivated(accountId)`
- Calls `applyLibraryProcessingChange`

### Revocation handler (`pack_reversed`, `unlimited_period_reversed`, `subscription_deactivated`)
- Receives revocation outcome from billing service
- Determines whether access was actually removed
- If access removed: emits `BillingChanges.candidateAccessRevoked(accountId)`
- Calls `applyLibraryProcessingChange`

## Out of scope

- Bridge ingress endpoint (S4-08)
- Billing service webhook handlers (S4-05–S4-07)
- UI reactions to billing events

## Likely touchpoints

| Area | Files |
|---|---|
| Bridge handlers | `src/lib/domains/billing/bridge-handlers.ts` *(new)* or similar |
| Billing domain | `src/lib/domains/billing/queries.ts` (reading billing state for revocation assessment) |
| Control plane | `applyLibraryProcessingChange` call site |

## Constraints / decisions to honor

- `billing_activation` marker prevents duplicate `unlimited_activated` emissions per period
- Control plane never sees billing details — only `songs_unlocked`, `unlimited_activated`, or `candidate_access_revoked`
- Revocation handler must check whether access was actually removed before emitting (e.g., if pack revocation didn't remove any unlocks, don't emit)

## Acceptance criteria

- [ ] Pack fulfillment emits `songsUnlocked` for bonus songs
- [ ] Unlimited activation inserts activation marker and emits `unlimitedActivated`
- [ ] Duplicate unlimited activation (same period) does not re-emit
- [ ] Revocation emits `candidateAccessRevoked` only when access was actually reduced
- [ ] All handlers call `applyLibraryProcessingChange`

## Verification

- Unit tests for each handler
- Integration test: bridge call → control-plane change emitted → reconciler schedules work

## Parallelization notes

- Depends on S4-08; can run immediately after it merges
- New files — minimal conflict risk

## Suggested PR title

`feat(billing): bridge handlers for pack fulfillment, unlimited activation, and revocation`
