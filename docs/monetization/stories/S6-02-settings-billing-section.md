# S6-02 · Settings Billing Section + Portal Launch

## Goal

Add a billing section to the settings page with plan info, subscription status, portal launch, and pack purchase entry.

## Why

Users need a dedicated place to see their billing status and manage their subscription after onboarding.

## Depends on

- S6-01 (billing state in route context)
- S4-10 (`createPortalSession` server function)

## Blocks

- None

## Scope

### Settings billing section
- Update `src/features/settings/SettingsPage.tsx`:
  - New billing section showing:
    - Current plan label
    - Subscription status (active, ending, past_due)
    - Subscription period end date (if applicable)
    - Balance (songs to explore) for pack users
  - **Portal launch button** (provider-enabled + has subscription): calls `createPortalSession`, redirects to Stripe Portal
  - **Buy more packs** entry point (provider-enabled + not unlimited): entry point to pack checkout
  - Pack entry points hidden while unlimited is active
  - Self-hosted: simple "Unlimited (Self-hosted)" status with no purchase actions
  - Provider-disabled: no billing section, or minimal status view

## Out of scope

- Song selection UI (S6-04)
- Paywall/upgrade CTAs (S6-05)
- Sidebar changes (S6-01)

## Likely touchpoints

| Area | Files |
|---|---|
| Settings | `src/features/settings/SettingsPage.tsx` |
| Route | `src/routes/_authenticated/settings.tsx` (may need billing state) |
| Server functions | `src/lib/server/billing.functions.ts` (createPortalSession) |

## Constraints / decisions to honor

- Portal launch only for provider-enabled accounts with subscriptions
- Pack purchase hidden while unlimited active
- Provider-disabled shows no purchase actions

## Acceptance criteria

- [ ] Billing section shows plan, status, period end
- [ ] Portal button launches Stripe Customer Portal
- [ ] Pack entry point visible for free/pack users (provider-enabled)
- [ ] Pack entry point hidden for unlimited users
- [ ] Self-hosted shows simple unlimited status
- [ ] Provider-disabled hides purchase actions

## Verification

- Manual: each billing state → correct settings display
- `bun run test` passes

## Parallelization notes

- Touches `SettingsPage.tsx` — unlikely to conflict with other stories
- Can run in parallel with S6-03, S6-04

## Suggested PR title

`feat(billing): settings billing section with portal launch and plan info`
