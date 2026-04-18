# S5-05 · Free Allocation on Completion

## Goal

When a user completes onboarding and stays free, auto-unlock up to 15 most-recent liked songs via `insert_song_unlocks_without_charge` with `source='free_auto'`.

## Why

Free allocation is the default path for users who don't purchase during onboarding. It must use the canonical unlock path and emit the correct control-plane change.

## Depends on

- S5-04 (plan selection determines user chose free)
- S2-06 (unlock orchestration — `grantFreeAllocation`)
- S1-05 (`insert_song_unlocks_without_charge` RPC)

## Blocks

- None directly

## Scope

- Wire the free path in onboarding completion:
  - When user stays free, call `grantFreeAllocation` from `unlocks.ts`
  - Unlocks up to 15 most-recent liked songs with `source='free_auto'`
  - If fewer than 15 liked songs exist, only those are unlocked; no carryforward
  - Emits `BillingChanges.songsUnlocked`
  - Calls `applyLibraryProcessingChange`
- Update `markOnboardingComplete` or its caller to trigger free allocation on the free branch

## Out of scope

- Pack/unlimited onboarding branches (S5-06)
- ReadyStep copy (S5-07)
- UI for the allocation

## Likely touchpoints

| Area | Files |
|---|---|
| Server functions | `src/lib/server/onboarding.functions.ts` |
| Billing domain | `src/lib/domains/billing/unlocks.ts` |
| Onboarding | Completion handler in onboarding route or component |

## Constraints / decisions to honor

- Free allocation is one-time; unused slots forfeited
- `source='free_auto'` — never deducts purchased balance
- Free allocation does NOT use `credit_balance`
- If user later buys a pack, the free unlocks persist

## Acceptance criteria

- [ ] Up to 15 most-recent liked songs unlocked on free completion
- [ ] Uses `source='free_auto'`
- [ ] No purchased balance deducted
- [ ] Fewer than 15 liked songs → only available songs unlocked
- [ ] `songsUnlocked` change emitted
- [ ] Enrichment jobs enqueued for unlocked songs

## Verification

- Test: user with 20 liked songs → 15 unlocked
- Test: user with 10 liked songs → 10 unlocked
- `bun run test` passes

## Parallelization notes

- Touches `onboarding.functions.ts` — coordinate with S5-07
- Can run in parallel with S5-06

## Suggested PR title

`feat(onboarding): free allocation of 15 songs on onboarding completion`
