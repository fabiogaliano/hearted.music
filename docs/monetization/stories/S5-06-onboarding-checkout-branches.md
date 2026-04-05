# S5-06 · Pack + Unlimited Onboarding Branches + Post-Checkout Polling

## Goal

Wire the pack and unlimited checkout flows during onboarding plan selection, including post-checkout polling for billing-state convergence.

## Why

Users who choose pack or unlimited during onboarding must complete checkout via Stripe and see their updated billing state before proceeding to `ready`. The post-checkout polling handles the gap between Stripe payment and webhook fulfillment.

## Depends on

- S5-04 (plan selection initiates checkout)
- S4-10 (`createCheckoutSession` server function)
- S2-02 (`getBillingState` for polling)

## Blocks

- None directly

## Scope

### Pack onboarding branch
- Plan selection → `createCheckoutSession({ offer: 'song_pack_500', checkoutAttemptId })`
- Redirect to Stripe Checkout
- On return: poll `getBillingState` for updated `creditBalance`
- Show updated balance and bonus-unlocked songs
- Navigate to `ready`

### Unlimited onboarding branch
- Plan selection → `createCheckoutSession({ offer: 'unlimited_yearly'|'unlimited_quarterly', checkoutAttemptId })`
- Show any conversion discount before redirect (if user had pack balance — edge case in onboarding)
- Redirect to Stripe Checkout
- On return: poll `getBillingState` for `unlimitedAccess.kind === 'subscription'`
- Navigate to `ready`

### Post-checkout polling
- Poll `getBillingState` on Stripe success redirect
- Stop after ~30–60s
- Fallback message: "Your purchase is being processed. Your songs to explore will appear shortly."
- Stripe webhook retry (up to 3 days) handles late delivery

## Out of scope

- Free allocation (S5-05)
- ReadyStep copy (S5-07)
- Song selection UI for pack users (Phase 6)

## Likely touchpoints

| Area | Files |
|---|---|
| Onboarding | `src/features/onboarding/components/PlanSelectionStep.tsx`, onboarding route |
| Billing server fns | `src/lib/server/billing.functions.ts` |
| Polling | New polling utility or inline in checkout success handler |

## Constraints / decisions to honor

- `checkoutAttemptId` is a UUID generated per checkout intent, reused across retries
- Polling should use exponential backoff or similar
- Stripe redirect back is not confirmation of fulfillment — must poll

## Acceptance criteria

- [ ] Pack checkout redirects to Stripe and returns to onboarding
- [ ] Unlimited checkout redirects to Stripe and returns to onboarding
- [ ] Post-checkout polling detects billing state update
- [ ] Fallback message shown after polling timeout
- [ ] Both branches navigate to `ready` after confirmation or timeout
- [ ] `checkoutAttemptId` reused on retry

## Verification

- Manual: complete pack checkout → return → balance updated
- Manual: complete unlimited checkout → return → unlimited access active
- Manual: slow webhook → fallback message shown

## Parallelization notes

- Touches `PlanSelectionStep.tsx` — coordinate with S5-04
- Can run in parallel with S5-05

## Suggested PR title

`feat(onboarding): pack and unlimited checkout branches with post-checkout polling`
