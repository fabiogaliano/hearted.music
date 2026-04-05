# S3-03 · Content Activation Stage

## Goal

Implement the content activation step in the enrichment orchestrator — the account-scoped stage that writes `item_status` and persists unlimited/self_hosted unlock rows for songs that became account-visible.

## Why

Content activation is the boundary between shared artifacts and account-visible state. Without it, `item_status` would still be written by generic pipeline completion (current behavior), which doesn't distinguish entitled from locked songs. This stage also persists unlock rows for unlimited users so access survives cancellation.

## Depends on

- S3-02 (orchestrator sub-batching — activation is the final step)
- S1-05 (`activate_unlimited_songs` RPC)
- S2-02 (readBillingState — activation checks current entitlement)

## Blocks

- S3-04 (removal of legacy `markPipelineProcessed` depends on activation taking over)

## Scope

- Add content activation step to the orchestrator, after shared stages:
  1. Re-query the selected song IDs against current DB truth
  2. Determine which songs are now account-visible (entitled + `song_analysis` exists)
  3. Write `item_status` for newly account-visible songs (via existing status query helpers or new helper)
  4. For unlimited/self_hosted users: call `activate_unlimited_songs` to persist unlock rows with subscription provenance
  5. Compute `newCandidatesAvailable` delta from the before/after candidate snapshots
- Does NOT wait for embedding — analysis is the visibility threshold
- Driven by current DB truth, not by "which songs ran B/C in this chunk"

## Out of scope

- Removing `markPipelineProcessed` (S3-04)
- Read-model changes (S3-07+)
- Match refresh changes (S3-05)

## Likely touchpoints

| Area | Files |
|---|---|
| Orchestrator | `src/lib/workflows/enrichment-pipeline/orchestrator.ts` |
| Status queries | `src/lib/domains/library/liked-songs/status-queries.ts` |
| Billing domain | `src/lib/domains/billing/queries.ts` or `unlocks.ts` |

## Constraints / decisions to honor

- `item_status` is written only by content activation, not generic pipeline completion
- Account-visible threshold: `is_account_song_entitled = true` AND `song_analysis` exists
- Unlimited unlock rows: `source='unlimited'` with `granted_stripe_subscription_id` and `granted_subscription_period_end`
- Self-hosted unlock rows: `source='self_hosted'`, no Stripe provenance
- Does not pre-materialize unlock rows for the whole library — only for songs that became visible in this batch

## Acceptance criteria

- [ ] `item_status` written only for entitled + analyzed songs
- [ ] Unlimited users get durable unlock rows with subscription provenance
- [ ] Self-hosted users get unlock rows with `source='self_hosted'`
- [ ] Songs that only completed Phase A do NOT get `item_status`
- [ ] Locked songs do NOT get `item_status`
- [ ] `newCandidatesAvailable` computed correctly from before/after delta

## Verification

- Test: entitled song with analysis → `item_status` written + unlock row created
- Test: locked song with analysis (from global cache) → no `item_status`
- Test: unlimited user → unlock row with subscription provenance
- `bun run test` passes

## Parallelization notes

- **Hot file**: `orchestrator.ts` — must land after S3-02, before S3-04
- Can run in parallel with read-model stories (S3-07+)

## Suggested PR title

`feat(billing): content activation stage in enrichment orchestrator`
