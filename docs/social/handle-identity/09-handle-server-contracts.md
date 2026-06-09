# Task 09 — Handle server contracts

**Plan:** §6.0–§6.3 · **Recommended order:** step 10 (sequenced **after** Task 08 — its order helpers like `isOnboardingStepBefore` are consumed here; see index dependency notes) · **Status:** [ ]

## Goal

Create the dedicated `src/lib/server/account-handle.functions.ts` with
`checkHandleAvailability` and `claimHandleAndAdvance`. These stay **out** of the
already-large `onboarding.functions.ts`. Expected business outcomes are returned
as typed values; only operational failures throw.

## Checklist

### Module + shared input schema (§6.0–§6.1)

- [ ] Create `src/lib/server/account-handle.functions.ts`
- [ ] Import session contracts from the domain module + `loadOnboardingSession` from the server session module; do **not** import `step-resolver.ts`
- [ ] Define transport-only `handleInputSchema = z.object({ handle: z.string() })` — no `.min/.max/.trim`/regex/reserved logic
- [ ] Both functions use `inputValidator(handleInputSchema)`

### `checkHandleAvailability` (§6.2)

- [ ] `GET`, `authMiddleware`, input `{ handle: string }`
- [ ] Return union: `available` | `already_owned` (with `ownedHandle` + `onboarding`) | `unavailable` (with `reason`) | `error`
- [ ] Lowercase (no trim) → `validateHandleFormatInput(data.handle)` first; on fail return `{ status: "unavailable", reason }`
- [ ] Self-owned exact match → `{ status: "available" }`, skip reserved/profanity/taken
- [ ] Caller has a **different** non-null handle → `already_owned` with `loadOnboardingSession(...)` recovery payload
- [ ] `isReservedHandle(normalizedHandle)` → `unavailable: "reserved"`
- [ ] Profanity check → `unavailable: "profanity"`
- [ ] Availability lookup on canonical `account.handle`, excluding caller's own id (plain equality) → `available` / `taken`
- [ ] Operational failures: log + return `{ status: "error" }` (do **not** throw)

### `claimHandleAndAdvance` (§6.3)

- [ ] `POST`, `authMiddleware`, input `{ handle: string }`
- [ ] Return union: `claimed` | `not_ready` | `already_owned` | `unavailable` (each with payloads per §6.3)
- [ ] Lowercase (no trim) → `validateHandleFormatInput` first → `unavailable` on fail
- [ ] Caller has a **different** handle → `already_owned`; equal handle → continue same-handle idempotent path (skip reserved/profanity/taken)
- [ ] No handle yet → load authoritative session; use `isOnboardingStepBefore(step, "claim-handle")` (from Task 08) to detect "too early"; if earlier than `claim-handle` → `not_ready`
- [ ] First-claim path: `isReservedHandle` → `unavailable: "reserved"`; else profanity check
- [ ] Call `claim_handle` RPC with `.single()`; validate the row with `claimHandleRpcRowSchema` (§6.3 step 6)
- [ ] `23505` → `unavailable: "taken"`; any other RPC/DB failure → throw
- [ ] Map parsed rows: `claimed` → return authoritative post-RPC session from `loadOnboardingSession({ accountId, accountHandle: owned_handle })` (use the **returned** `ownedHandle`, not stale `context.account.handle` or bare `normalizedHandle`); `already_owned` → recovery payload; `not_ready` → recovery payload
- [ ] Missing/shape-invalid RPC data → let schema parsing throw (operational, not a business branch)

## Key intent

- The self-owned exact-match bypass is intentional: an immutable handle is
  grandfathered for stale re-entry even if a later reserved/profanity policy change
  would block the same string — otherwise the user is stranded with no rename path.
- The server pre-check duplicates the SQL RPC guard on purpose: the function gives
  the client a typed recovery without attempting the write; the RPC is the final
  backstop.
- No dedicated rate limiting in v0 (§6.5).

## Dependencies

Tasks 03 (rules/profanity), 05 (contracts), 06 (`loadOnboardingSession`),
08 (`isOnboardingStepBefore`), 02 (RPC). Consumed by Task 11.

## Related tests

Task 15 → §14.4 (`checkHandleAvailability` + `claimHandleAndAdvance` contract tests).
