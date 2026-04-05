# S2-06 · Unlock Orchestration Module

## Goal

Implement `src/lib/domains/billing/unlocks.ts` — the TypeScript module that orchestrates unlock requests, calls the appropriate RPCs, and emits control-plane changes.

## Why

Multiple code paths need to unlock songs (manual pack selection, free allocation, pack bonus processing). Centralizing the orchestration in one module prevents each caller from independently wiring RPC calls, balance checks, and control-plane emission.

## Depends on

- S2-01 (types)
- S2-02 (billing queries)
- S2-05 (BillingChanges helpers)
- S1-05, S1-06 (unlock and pack RPCs)

## Blocks

- Phase 3 (content activation uses unlock orchestration)
- Phase 5 (free allocation uses this module)
- Phase 6 (requestSongUnlock server function)

## Scope

### `src/lib/domains/billing/unlocks.ts`
- `requestSongUnlock(supabase, accountId, songIds)` — calls `unlock_songs_for_account` RPC, emits `BillingChanges.songsUnlocked`, calls `applyLibraryProcessingChange`
- `grantFreeAllocation(supabase, accountId)` — determines up to 15 most-recent liked songs, calls `insert_song_unlocks_without_charge` with `source='free_auto'`, emits change
- Returns structured results (newly unlocked IDs, already unlocked IDs, remaining balance) or typed errors (insufficient balance, invalid songs)

### `requestSongUnlock` server function
- In `src/lib/server/billing.functions.ts`
- Validates input, delegates to `unlocks.ts`, returns result

## Out of scope

- Pack fulfillment orchestration (triggered by bridge, not user action)
- Checkout/portal server functions (Phase 4)
- UI for song selection (Phase 6)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing domain | `src/lib/domains/billing/unlocks.ts` *(new)* |
| Server functions | `src/lib/server/billing.functions.ts` |

## Constraints / decisions to honor

- All-or-nothing for net-new unlocks — no partial fulfillment
- Error returned as typed value, not thrown exception
- Free allocation forfeits unused slots (no carryforward)
- `requestSongUnlock` must not be callable when account has active unlimited access

## Acceptance criteria

- [ ] `requestSongUnlock` calls RPC, emits control-plane change, returns structured result
- [ ] Insufficient balance returns typed error (not thrown)
- [ ] `grantFreeAllocation` unlocks up to 15 most-recent liked songs
- [ ] Free allocation uses `source='free_auto'`, does not deduct balance
- [ ] Server function validates input and delegates correctly
- [ ] Project compiles

## Verification

- Unit tests with mocked Supabase
- `tsc --noEmit` passes

## Parallelization notes

- Can start after S2-02 and S2-05 merge
- Touches new files only — no merge conflicts expected

## Suggested PR title

`feat(billing): unlock orchestration module and requestSongUnlock server function`
