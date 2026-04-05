# S5-07 · ReadyStep Copy Update + Provider-Disabled Onboarding Path

## Goal

Update `ReadyStep` copy to reflect billing-aware behavior and verify the provider-disabled onboarding path works end to end.

## Why

The current `ReadyStep` says "Going through every song" which is only true for unlimited users. Free and pack users need different copy. Provider-disabled mode must auto-skip `plan-selection` and enter self-hosted unlimited flow.

## Depends on

- S5-01 (step enum expansion)
- S5-05 (free allocation)
- S2-03 (self-hosted provisioning)

## Blocks

- None

## Scope

### ReadyStep copy update
- Update `src/features/onboarding/components/ReadyStep.tsx`:
  - Free: "Exploring your 15 songs…" (or similar)
  - Pack: "Exploring your selected songs…"
  - Unlimited: "Going through every song…" (current copy, retained for this branch)
  - Self-hosted: "Going through every song…"
- Read billing state to determine which copy variant to show

### Provider-disabled onboarding path
- Verify `plan-selection` auto-skips when `BILLING_ENABLED=false`
- Verify self-hosted account goes directly from `match-showcase` to `ready`
- Verify full-library processing starts through normal unlimited entitlement path
- Fix any issues found

## Out of scope

- Onboarding step components (S5-02–S5-04)
- Checkout flows (S5-06)
- Post-onboarding UI (Phase 6)

## Likely touchpoints

| Area | Files |
|---|---|
| ReadyStep | `src/features/onboarding/components/ReadyStep.tsx` |
| Billing domain | `src/lib/domains/billing/queries.ts` (getBillingState for copy variant) |
| Onboarding | `src/features/onboarding/Onboarding.tsx` (step skip logic) |

## Constraints / decisions to honor

- Copy is soft (can change without migration), but must be billing-accurate
- Provider-disabled path must not show any billing UI or purchase surfaces

## Acceptance criteria

- [ ] ReadyStep shows correct copy for free, pack, unlimited, and self-hosted users
- [ ] Provider-disabled user skips `plan-selection` step
- [ ] Provider-disabled user reaches `ready` → `complete` without billing interaction
- [ ] Full-library processing starts for self-hosted users after onboarding
- [ ] No purchase-related copy shown in provider-disabled mode

## Verification

- Manual: each onboarding branch → correct ReadyStep copy
- Manual: provider-disabled → plan-selection skipped → full processing
- `bun run test` passes

## Parallelization notes

- Touches `ReadyStep.tsx` — unlikely to conflict with other stories
- Can run in parallel with S5-05, S5-06

## Suggested PR title

`feat(onboarding): billing-aware ReadyStep copy and provider-disabled path validation`
