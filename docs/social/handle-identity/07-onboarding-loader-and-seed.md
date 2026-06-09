# Task 07 — Onboarding loader + claim-handle seed

**Plan:** §7.3 · **Recommended order:** step 9 · **Status:** [x]

## Goal

Thread `claimHandleSeed` and `accountId` through the onboarding loader/context so
the claim step never has to infer ownership state from a flattened string or guess
`accountId` from the auth cache. Crucially, make `loadOnboardingData()` reuse the
**same** handle-aware session helper as `loadOnboardingSession()` so the full
payload can't disagree with the guard session.

## Checklist

### Loader-data shapes (§7.3)

- [ ] Extend `OnboardingData extends OnboardingAuthPayload` with `accountId: string` and `claimHandleSeed: ClaimHandleSeed` (full shape in §7.3)
- [ ] Extend `StepContext` with `accountId: string` and `claimHandleSeed: ClaimHandleSeed`
- [ ] Keep `syncStats` server-loaded only — do **not** reintroduce a router-state `syncStats` duplicate (its removal is Task 08)

### Wiring

- [ ] `getOnboardingData` calls `loadOnboardingData({ accountId: context.session.accountId, account: context.account })`
- [ ] Update `loadOnboardingData`'s signature to take the explicit `account` row
- [ ] After loading `prefs`, build the auth payload via `deriveAuthPayloadFromPrefs({ accountId, accountHandle: account.handle, prefs, supabase })` — reuse the prefs already read, no second prefs/account lookup
- [ ] Remove any second step-only `authPayloadPromise` path that ignores `account.handle`
- [ ] Derive `claimHandleSeed = deriveClaimHandleSeed({ accountHandle: account.handle, displayName: account.display_name })` from the same explicit account row
- [ ] Thread explicit `accountId` from `src/routes/_authenticated/onboarding.tsx` → `Onboarding` → `StepContext`
- [ ] `ClaimHandleStep` must be able to build its React Query key `['onboarding', 'handle-availability', accountId, ownedHandleSnapshot, debouncedHandle]` from threaded `accountId` (not the auth cache / route imports)
- [ ] `claim-handle-seed.ts` stays the **owner** of `ClaimHandleSeed`; `onboarding.functions.ts` only consumes it

## Files touched

`src/lib/server/onboarding.functions.ts` (`loadOnboardingData`, `OnboardingData`),
`src/routes/_authenticated/onboarding.tsx`, `src/features/onboarding/Onboarding.tsx`
(`StepContext`), `src/features/onboarding/types.ts`.

## Dependencies

Task 03 (`deriveClaimHandleSeed`), Task 05 (`OnboardingAuthPayload`),
Task 06 (`deriveAuthPayloadFromPrefs`). Pairs with Task 08 (shares edits to
`onboarding.functions.ts` / `Onboarding.tsx`).

## Related tests

Task 15 → §14.7 (`getOnboardingData()`/`getOnboardingSession()` agreement),
§14.2 (seed: existing handle wins over display-name prefill).
