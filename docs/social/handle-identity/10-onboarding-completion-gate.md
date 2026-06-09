# Task 10 — Onboarding completion gate

**Plan:** §6.4, §7.2 item 22 · **Recommended order:** after step 11 (no distinct §13.2 step; sits between Tasks 09 and 11 — see index) · **Status:** [ ]

## Goal

Turn `markOnboardingComplete()` from an unconditional `{ success: true }` write
into an authoritative completion gate, and wire `PlanSelectionStep` to its
structured result. This closes the current hole where a stale client or devtools
action could stamp `onboarding_completed_at` before a handle exists.

`markOnboardingComplete` stays in `onboarding.functions.ts` (it is onboarding
completion, not handle infrastructure), but its new behavior depends on the
handle-aware session loader (Task 06).

## Checklist

### `markOnboardingComplete` (§6.4)

- [ ] `POST`, `authMiddleware`, no input payload
- [ ] Return union: `completed_now` | `already_complete` | `not_ready` (each `{ onboarding: OnboardingAuthPayload }`)
- [ ] Load authoritative `currentOnboarding = loadOnboardingSession({ accountId, accountHandle: context.account.handle })` first
- [ ] `session.status === "complete"` → `already_complete` immediately (do **not** rerun `completeOnboardingWithAllocations(...)` / duplicate free-allocation side effects)
- [ ] `session.status !== "plan-selection"` → `not_ready` (covers earlier steps + handle-less rows collapsed to `claim-handle`)
- [ ] Only when authoritative session is exactly `plan-selection` may it call `completeOnboardingWithAllocations(...)`
- [ ] After the write, rebuild the returned session from **freshly re-read account state** (not stale `context.account.handle`); the post-write session **must** be `{ status: "complete" }` or throw (operational invariant)
- [ ] Keep `completeOnboardingWithAllocations(...)` as the lower-level helper; no UI/devtools path may call it directly

### `PlanSelectionStep.tsx` (§7.2 item 22)

- [ ] Replace the success-assumed `/dashboard` push with the structured contract
- [ ] `completed_now` → patch `["auth", "onboarding-session"]`, fire `analytics.capture("onboarding_completed", ...)`, navigate via `resolveSession(onboarding.session)`
- [ ] `already_complete` → patch cache + navigate via `resolveSession()`, but do **not** fire completion analytics again
- [ ] `not_ready` → patch cache + navigate via `resolveSession()`, do **not** toast (authoritative stale recovery)
- [ ] Only operational failures toast

## Dependencies

Task 06 (`loadOnboardingSession`), Task 05 (`resolveSession` `/dashboard`),
Task 08 (referenced by `DevWorkflowPanel` for `complete` navigation).

## Related tests

Task 15 → §14.4 (`markOnboardingComplete` contract), §14.7 (`PlanSelectionStep`
analytics gating + `not_ready` navigation).
