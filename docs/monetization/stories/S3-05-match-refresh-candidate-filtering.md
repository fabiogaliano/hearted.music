# S3-05 · Match Refresh Candidate Filtering

## Goal

Update match snapshot refresh to use `select_entitled_data_enriched_liked_song_ids` so only entitled + fully-enriched songs are matching candidates.

## Why

The current match refresh selector (`select_data_enriched_liked_song_ids`) returns all enriched songs without entitlement filtering. Revoked or locked songs must be excluded from matching candidates.

## Depends on

- S1-11 (billing-aware match refresh selector RPC)
- S1-12 (generated types)

## Blocks

- None directly (but must land before Phase 4 bridge work triggers candidate_access_revoked)

## Scope

- Update `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`:
  - Replace call to `select_data_enriched_liked_song_ids` with `select_entitled_data_enriched_liked_song_ids`
  - The new RPC requires all 4 shared artifacts + effective entitlement

## Out of scope

- Read-time match filtering in loaders (S3-10)
- Reconciler changes for `candidate_access_revoked` (S3-06)
- Old selector removal (can coexist until verified)

## Likely touchpoints

| Area | Files |
|---|---|
| Match refresh | `src/lib/workflows/match-snapshot-refresh/orchestrator.ts` |

## Constraints / decisions to honor

- Candidate eligibility: audio features + genres + analysis + embedding + entitlement
- Does NOT require `item_status`
- Revoked songs excluded

## Acceptance criteria

- [ ] Match refresh uses the billing-aware selector
- [ ] Revoked songs excluded from candidates
- [ ] Locked songs excluded from candidates
- [ ] Self-hosted/unlimited songs included
- [ ] Project compiles

## Verification

- Test: revoked song with all artifacts → excluded from candidates
- Test: entitled song with all artifacts → included
- `bun run test` passes

## Parallelization notes

- Can run in parallel with all other Phase 3 stories (touches only match-snapshot-refresh)

## Suggested PR title

`feat(billing): entitlement-filtered match refresh candidates`
