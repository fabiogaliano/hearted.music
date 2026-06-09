# Task 06 — Onboarding session server primitives

**Plan:** §6.0, §7.2 item 16 · **Recommended order:** step 8 · **Status:** [x]

## Goal

Extract the guard-critical session loading/derivation into a small shared server
module, and make session derivation **handle-aware**. This is the keystone that
makes `getOnboardingSession()` and `getOnboardingData()` agree on `session.status`
for the same rows — they must both call the one shared construction helper.

## Checklist

### New `src/lib/server/onboarding-session.ts`

- [ ] Move `deriveSession(...)`, `deriveAuthPayloadFromPrefs(...)`, `loadOnboardingSession(...)` here
- [ ] Public exports: `deriveAuthPayloadFromPrefs(...)` and `loadOnboardingSession(...)` only; `deriveSession(...)` stays **internal**
- [ ] Import `OnboardingAuthPayload` / `OnboardingSession` / `WalkthroughSong` from the domain module (Task 05); do **not** redefine them here
- [ ] `deriveAuthPayloadFromPrefs(args)` exact signature:
  ```ts
  deriveAuthPayloadFromPrefs(args: {
    accountId: string;
    accountHandle: string | null;
    prefs: UserPreferences;
    supabase: AdminSupabaseClient;
  }): Promise<OnboardingAuthPayload>
  ```
- [ ] `loadOnboardingSession(args: { accountId: string; accountHandle: string | null }): Promise<OnboardingAuthPayload>`
- [ ] `deriveAuthPayloadFromPrefs(...)` is the **single** session-construction helper used by both `loadOnboardingSession(...)` and `loadOnboardingData(...)`

### Handle-aware `deriveSession(...)`

- [ ] New signature: `deriveSession(accountId, accountHandle, onboardingStep, onboardingCompletedAt, walkthroughSong): OnboardingSession`
- [ ] Completion check stays **first**: non-null `onboardingCompletedAt` → `{ status: "complete" }` regardless of handle (unchanged)
- [ ] Then, for unfinished onboarding only, enforce the handle prerequisite: if `accountHandle` is null **and** `onboardingCompletedAt` is null **and** persisted step is `claim-handle` or any later token (incl. inconsistent `complete`-without-timestamp) → `{ status: "claim-handle" }`
- [ ] Treat the same invalid/unknown unfinished tokens as pre-claim (mirrors `deriveAuthPayloadFromPrefs`'s `"welcome"` fallback) so the SQL RPC guard and this stay aligned

## Why this shape

Missing-handle is authoritative over later saved step tokens **for unfinished
onboarding only**; the completion timestamp stays the top authority. A completed
row with a null handle (only producible by pre-feature data or manual SQL) omits
the handle on read surfaces and returns to first-claim via the §13.3 reset path —
it is **not** dragged back to `claim-handle`.

## Dependencies

Task 04, Task 05. Unblocks Tasks 07, 09, 10.

## Related tests

Task 15 → §14.7 (handle-less pinning to `claim-handle`; `getOnboardingSession()`
vs `getOnboardingData()` agreement), §14.1 (session derivation).
