# Handle Identity — Review Findings

Branch `feat/handle-identity` reviewed against `handle-identity-implementation-plan.md` (the authoritative spec). 2026-06-09.

Checklist legend: `[ ]` = open / action recommended · `[x]` = verified, no action.

## Gates

- [x] `bun run typecheck` → exit 0
- [x] `bun run test` → 1560 passed / 8 skipped (168 files)
- [x] `claim_handle` RPC integration → **21/21** against live local DB (skips in normal `bun run test` without `DATABASE_URL`)

---

## P0 — fix before / right after ship (affects the claim experience)

### [ ] 1. `ClaimHandleStep` re-fires availability after a submit-time `unavailable`, flickering the status — MAJOR

- **Where:** `src/features/onboarding/components/ClaimHandleStep.tsx:177-182` (`queryEnabled`), `:456-464` (submit handler).
- **Trigger:** user loses a uniqueness race → `claimHandleAndAdvance` returns `unavailable` (`taken`) at submit time.
- **What happens:** `setSubmitInFlight(false)` (`:460`) re-enables the query for the **unchanged** value (`queryEnabled` gates on `!submitInFlight` but not on the submit verdict). With `staleTime: 0`, React Query refetches. In `dynamicStatus`, `isChecking` (`:534`) is checked **before** the unavailable branch (`:543`), so the status reads **"That handle is taken." → "Checking availability…" → "That handle is taken."** plus an unnecessary server round-trip.
- **Spec:** §8.4 — *"do not auto-fire a follow-up availability request for the same unchanged value after a submit-time unavailable result."* Violated.
- **Fix (one line):** add `&& submitTimeUnavailable === null` to `queryEnabled`. `handleChange` already clears `submitTimeUnavailable` on edit (`:308`), so edit-then-recheck is unaffected.
- **Test gap:** no assertion that the request does **not** refire. The two `submit-time unavailable` tests (`ClaimHandleStep.test.tsx:705,733`) check final inline error + focus, which survive the flicker. Add a "no follow-up request" assertion.
- **Validation:** confirmed by reading the state machine end-to-end; verdict stays correct (Continue stays disabled) so impact is the visible flicker + redundant GET, not a broken claim. Decision log task 11 corroborates the gap ("submitInFlight … reset together") — the in-flight window was modeled, the post-settle case was not.

---

## Verified faithful (spot-checked against spec, no action)

- [x] **Migrations (§4):** both files match the spec verbatim; RPC behavior live-verified (not_ready gating, forward canonicalization to `flag-playlists`, `phase_job_ids` clear, completion-stamp preservation, uniqueness, DB format rejection, concurrent resolution, missing-row rollback).
- [x] **Server contracts (§6.2/6.3):** format-first validation, self-owned grandfather bypass, `isOnboardingStepBefore` not_ready gate, `.single()` + Zod row schema, `23505` → `taken` (`account-handle.functions.ts:239`), fresh-handle session reload on each branch.
- [x] **`markOnboardingComplete` (§6.4):** loads authoritative session first, `already_complete`/`not_ready`/`completed_now`, fresh account re-read after write, post-write `complete` invariant throw.
- [x] **Session derivation (§7.2):** completion-timestamp first, null-handle pin for unfinished, complete-without-timestamp split, single `deriveAuthPayloadFromPrefs` so `getOnboardingData`/`getOnboardingSession` can't disagree.
- [x] **Step machine (§7.1):** `SAVEABLE_*` excludes `complete`, walkthrough demo-song precondition, `clearsSyncPhaseJobIds`, order helpers.
- [x] **Domain rules (§5):** validation precedence chain, reserved set, prefill, seed, server-only profanity.
- [x] **Navigation (§7.2):** `useOnboardingNavigation` transition contract, `SyncingStep` → `claim-handle` with no-auto-retry lock, `PlanSelectionStep` fires analytics only on `completed_now` + navigates via `resolveSession`, `DevWorkflowPanel` routes `complete` → `markOnboardingComplete`, `/onboarding` guard uses `compareOnboardingSteps` with no-playlists skip kept explicit.
- [x] **Public route + read surfaces (§9):** lowercase-canonical redirect before lookup, `notFound` vs operational-throw split, inner-join on `onboarding_completed_at`, handle-first identity everywhere with null-omit (no `display_name`/`email` fallback), byte-accurate copy.
- [x] **Config + reset (§10/§13.3):** `VITE_PUBLIC_APP_ORIGIN` required+URL-validated from `clientEnv`, single trailing-slash trim, email modules use the shared helper, reset clears `account.handle` with updated copy.

---

## Not blocking for prod (robustness, a11y, nits, code health)

- [ ] **Double-submit race** — `ClaimHandleStep.tsx:334-482`. No-op guards don't check `submitInFlight`; two synchronous Enter presses can fire `claimHandleAndAdvance` twice. Neutralized in practice by the idempotent RPC (`FOR UPDATE` serializes; same-handle re-entry returns `claimed`) and the success branch unmounting. Add an early `if (submitInFlight) return;` for robustness.
- [ ] **Preview is `aria-hidden`** (a11y) — `ClaimHandleStep.tsx:700`. The `Public URL` preview isn't exposed to assistive tech; sighted-only confirmation. Defensible (the `aria-live` status already says "Available."), spec doesn't mandate it. Judgment call.
- [ ] **`deriveSession` uses raw `indexOf`** (code health) — `onboarding-session.ts:68-70`. §7.1 says centralize order logic; this inlines `stepIndex >= claimHandleIndex` instead of `!isOnboardingStepBefore(...)`. Behaviorally identical; already flagged in a code comment as deferred.
- [x] **Multiplicity collapse in public query** (accepted) — `queries.ts` via `fromSupabaseMaybe` maps `PGRST116` → `ok(null)` instead of `err`. `account.handle` is `UNIQUE` + `user_preferences` is 1:1, so the `>1` branch is structurally dead. Accepted in decision log (task 13); matching the ~28 existing callers beats a one-off wrapper.
- [ ] **Code nits** — `ClaimHandleStep.tsx`: dead `value` arm in `previewHandle` ternary (`:575-579`); `submitInFlight`/`isSubmitting` always set together (could be one state); `React.FormEvent` kept to match `WaitlistInput` convention despite the `@types/react@19` deprecation hint (no typecheck error).
