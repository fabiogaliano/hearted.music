# S5-04 · Plan Selection Step

## Goal

Implement the `plan-selection` onboarding step that presents free / pack / unlimited options and handles the user's choice.

## Why

Plan selection is where the user converts — after seeing product value through the showcases. It must present clear options and route to the correct billing branch.

## Depends on

- S5-01 (step enum)
- S4-10 (`createCheckoutSession` server function)
- S2-01 (env config: `QUARTERLY_PLAN_ENABLED`)

## Blocks

- S5-05 (free allocation on completion)
- S5-06 (checkout branches)

## Scope

- New component: `PlanSelectionStep`
- Presents three paths:
  - **Free**: continue with 15 songs → navigates to `ready`
  - **Pack**: 500 songs + 25 instant unlocks for $5.99 → initiates checkout
  - **Unlimited**: yearly $39.99/yr (quarterly $14.99/quarter if `QUARTERLY_PLAN_ENABLED`) → initiates checkout
- For unlimited: show any first-invoice discount from unused purchased pack value
- Auto-skipped when `BILLING_ENABLED=false`
- `QUARTERLY_PLAN_ENABLED=false` hides quarterly option

## Out of scope

- Free allocation logic (S5-05)
- Post-checkout polling (S5-06)
- Checkout server function implementation (S4-10)
- Detailed pricing design/copy

## Likely touchpoints

| Area | Files |
|---|---|
| Component | `src/features/onboarding/components/PlanSelectionStep.tsx` *(new)* |
| Onboarding | `src/features/onboarding/Onboarding.tsx` |
| Billing server fns | `src/lib/server/billing.functions.ts` (createCheckoutSession) |

## Constraints / decisions to honor

- Auto-skip when `BILLING_ENABLED=false`
- `QUARTERLY_PLAN_ENABLED` gates quarterly visibility
- Internal offer IDs used — no Stripe price IDs in UI code
- Pack purchase entry points hidden if user already has unlimited (edge case: shouldn't happen in onboarding)

## Acceptance criteria

- [ ] Three plan options displayed (free, pack, unlimited)
- [ ] Quarterly hidden when `QUARTERLY_PLAN_ENABLED=false`
- [ ] Free path advances to `ready`
- [ ] Pack/unlimited paths initiate checkout via `createCheckoutSession`
- [ ] Step auto-skipped when `BILLING_ENABLED=false`
- [ ] Project compiles

## Verification

- Manual: select each plan option → correct branch followed
- `bun run test` passes

## Parallelization notes

- New component — no merge conflicts expected
- Depends on S4-10 for checkout integration

## Suggested PR title

`feat(onboarding): plan selection step with free, pack, and unlimited options`
