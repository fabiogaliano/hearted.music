# S7-01 · E2E: Free Onboarding + Pack Purchase Flows

## Goal

Validate end-to-end: fresh free onboarding → free allocation → processing → results; and pack purchase → bonus unlocks → manual selection → processing → results.

## Why

These are the most common user paths. Validating them end to end in Stripe test mode ensures the core monetization loop works from signup to value delivery.

## Depends on

- Phases 1–6 complete

## Blocks

- None (validation story)

## Scope

- Fresh free onboarding: create account → onboarding → free allocation → 15 songs unlocked → Phase B/C processes → content activation → read models show analyzed → match results available
- Pack purchase: exhaust/insufficient free balance → paywall → pack checkout → fulfillment → 500 balance + 25 bonus unlocks → manual selection → unlock → processing → results
- Verify in Stripe test mode
- Document any issues found; fix or create follow-up stories

## Out of scope

- Unlimited flows (S7-02)
- Refund flows (S7-03)
- Concurrency testing (S7-04)

## Likely touchpoints

| Area | Files |
|---|---|
| Tests | `tests/` — integration/e2e tests |
| All billing, onboarding, and liked-songs code paths |

## Constraints / decisions to honor

- Test from truly fresh accounts, not reseeded data
- Validate in both provider-enabled and provider-disabled modes

## Acceptance criteria

- [ ] Fresh free user gets 15 songs unlocked and processed
- [ ] Pack purchase updates balance and creates bonus unlocks
- [ ] Manual selection unlocks songs and triggers processing
- [ ] Results visible in liked songs and matching pages
- [ ] No orphaned billing state

## Verification

- Manual Stripe test-mode walkthrough
- Integration tests covering the full path

## Parallelization notes

- Can run in parallel with S7-02, S7-03

## Suggested PR title

`test(billing): e2e validation of free onboarding and pack purchase flows`
