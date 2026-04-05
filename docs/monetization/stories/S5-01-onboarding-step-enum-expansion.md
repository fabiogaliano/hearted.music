# S5-01 · Onboarding Step Enum Expansion

## Goal

Add `song-showcase`, `match-showcase`, `plan-selection` to the `ONBOARDING_STEPS` enum and update step persistence, routing, and the step config.

## Why

The onboarding state machine must know about the new monetization steps before any step components can be built. This is the structural change that all other onboarding stories depend on.

## Depends on

- Phase 3 complete (entitlement-safe app)

## Blocks

- S5-02 through S5-07 (all new step components)

## Scope

- Update `ONBOARDING_STEPS` in `src/lib/domains/library/accounts/preferences-queries.ts`:
  - New values: `song-showcase`, `match-showcase`, `plan-selection`
  - Sequence: welcome → pick-color → install-extension → syncing → flag-playlists → song-showcase → match-showcase → plan-selection → ready → complete
- Update `src/features/onboarding/Onboarding.tsx` step config to include new steps (placeholder components initially)
- Update `src/routes/_authenticated/onboarding.tsx` route loader if it validates step values
- Update `src/lib/server/onboarding.functions.ts` for step persistence
- Auto-skip `plan-selection` when `BILLING_ENABLED=false`

## Out of scope

- Step component implementations (S5-02–S5-05)
- Free allocation logic (S5-06)
- Checkout flows during onboarding (S5-07)

## Likely touchpoints

| Area | Files |
|---|---|
| Preferences | `src/lib/domains/library/accounts/preferences-queries.ts` |
| Onboarding | `src/features/onboarding/Onboarding.tsx`, `types.ts` |
| Route | `src/routes/_authenticated/onboarding.tsx` |
| Server functions | `src/lib/server/onboarding.functions.ts` |

## Constraints / decisions to honor

- Step IDs are frozen: `song-showcase`, `match-showcase`, `plan-selection`
- `plan-selection` auto-skips when `BILLING_ENABLED=false`
- Steps stored as text in `user_preferences` — Zod validates, no DB enum

## Acceptance criteria

- [ ] Zod enum includes new step values
- [ ] Step navigation flows through new steps in correct order
- [ ] `plan-selection` auto-skips in provider-disabled mode
- [ ] Placeholder components render without errors
- [ ] Existing onboarding flow unchanged for steps 1–5
- [ ] Project compiles

## Verification

- Manual: navigate through onboarding → new steps appear (placeholder)
- `bun run test` passes

## Parallelization notes

- Touches onboarding files — should merge before S5-02 through S5-07
- Does not conflict with Phase 6 stories

## Suggested PR title

`feat(onboarding): expand step enum with song-showcase, match-showcase, plan-selection`
