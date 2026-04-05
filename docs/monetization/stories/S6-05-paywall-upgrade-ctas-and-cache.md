# S6-05 · Paywall + Upgrade CTAs + Post-Purchase Cache Invalidation

## Goal

Implement paywall/upgrade prompts when purchased balance hits zero, pack/unlimited purchase entry points, and cache invalidation after all purchase flows.

## Why

Users who exhaust their balance need a clear path to buy more songs or upgrade. All purchase flows must correctly invalidate cached billing state, liked songs, and stats so the UI reflects the new state.

## Depends on

- S6-04 (unlock flow triggers paywall on insufficient balance)
- S4-10 (`createCheckoutSession` server function)
- S6-01 (billing state in context)

## Blocks

- None

## Scope

### Paywall
- Zero-balance prompt: "Out of explorations. Explore more songs."
- Displayed when unlock attempt fails with insufficient balance
- May also appear as a CTA in liked songs page when balance is zero
- Entry points to pack purchase and unlimited upgrade

### Pack purchase entry point
- Calls `createCheckoutSession({ offer: 'song_pack_500', checkoutAttemptId })`
- Redirects to Stripe Checkout
- Hidden/disabled while unlimited is active
- Provider-enabled only

### Unlimited upgrade entry point
- Show any first-invoice discount from unused purchased pack value
- Calls `createCheckoutSession({ offer: 'unlimited_yearly'|'unlimited_quarterly', checkoutAttemptId })`
- Redirects to Stripe Checkout
- `QUARTERLY_PLAN_ENABLED` gates quarterly option
- Provider-enabled only

### Post-purchase cache invalidation
- After checkout return: invalidate billing state, liked songs, and stats queries
- After portal return: invalidate billing state queries
- After successful unlock: invalidate liked songs, stats, billing state queries
- Ensure `useActiveJobs` handles billing-triggered job completions

## Out of scope

- Settings billing section (S6-02)
- Locked song rendering (S6-03)
- Song selection (S6-04)

## Likely touchpoints

| Area | Files |
|---|---|
| Paywall | New component in `src/features/liked-songs/*` or `src/features/billing/*` |
| Liked songs | `src/features/liked-songs/*` (zero-balance CTA) |
| Query cache | `src/features/liked-songs/queries.ts`, `src/features/dashboard/queries.ts`, billing queries |
| Server functions | `src/lib/server/billing.functions.ts` |

## Constraints / decisions to honor

- Internal offer IDs only — no Stripe price IDs in UI
- `checkoutAttemptId` generated per checkout intent
- Pack purchase hidden while unlimited active
- `QUARTERLY_PLAN_ENABLED` gates quarterly

## Acceptance criteria

- [ ] Paywall shown when balance is zero
- [ ] Pack purchase entry point works and redirects to Stripe
- [ ] Unlimited upgrade entry point works with conversion discount display
- [ ] Both hidden in provider-disabled mode
- [ ] Pack hidden while unlimited active
- [ ] Cache invalidated after checkout, portal, and unlock flows
- [ ] UI reflects updated state without manual refresh

## Verification

- Manual: exhaust balance → paywall → purchase → return → balance updated
- Manual: upgrade to unlimited → return → unlimited state reflected
- `bun run test` passes

## Parallelization notes

- New components mostly — coordinate with S6-04 on liked songs page
- Can run after S6-04 merges

## Suggested PR title

`feat(billing): paywall, upgrade CTAs, and post-purchase cache invalidation`
