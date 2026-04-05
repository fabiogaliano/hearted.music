# Feature: Onboarding Monetization

> **Feature 05** · Dependency: Features 03–04 · Can parallelize with Feature 06 after Feature 04 bridge contracts land

## Goal

Integrate monetization into the first-user experience: demonstrate product value through a guided showcase, present plan options, and translate the user's choice into real billing primitives (free allocation, pack purchase, or unlimited activation).

## Why it exists

Onboarding has requirements that don't map to the general in-app purchase flow:

- New step sequencing (`song-showcase` → `match-showcase` → `plan-selection`) that must be inserted into the existing state machine
- A dedicated demo/showcase path using a pre-seeded song, completely outside monetization
- Free allocation timing tied to onboarding completion
- Provider-disabled auto-skip behavior for `plan-selection`
- Copy updates to the `ReadyStep` that must reflect per-plan processing semantics

Building this on top of working entitlement enforcement (Feature 03) and checkout plumbing (Feature 04) ensures the onboarding flow exercises real billing paths rather than mock logic.

## What this feature owns

- **Onboarding step expansion**: add `song-showcase`, `match-showcase`, `plan-selection` to `ONBOARDING_STEPS` enum
- **Song showcase step**: presents analysis of a pre-seeded demo song; demo song is outside monetization (no unlock row, no credit use, no replacement credit)
- **Match showcase step**: runs live match against real target playlists using the pre-seeded demo song with `priority` queue band; falls back to canned demo result after ~10–15s timeout
- **Playlist profiling trigger**: trigger target-playlist profiling during `flag-playlists` step so profiles are ready for the match showcase
- **Plan selection step**: presents free / pack / unlimited options; auto-skipped when `BILLING_ENABLED=false`
- **Free allocation on completion**: calls `insert_song_unlocks_without_charge(up to 15 most-recent liked songs, source='free_auto')` and emits `BillingChanges.songsUnlocked(...)` when user stays free
- **Pack onboarding branch**: user purchases pack → 500 purchased credits + up to 25 pack bonus unlocks → user sees updated state
- **Unlimited onboarding branch**: user starts unlimited checkout → conversion discount shown if applicable → checkout redirects to Stripe → activation flows through Feature 04 bridge
- **Provider-disabled branch**: `plan-selection` auto-skipped; account already has `self_hosted` unlimited; full-library processing eligible immediately
- **`ReadyStep` copy update**: billing-aware copy variants (free: "Exploring your 15 songs…", pack: "Exploring your selected songs…", unlimited: "Going through every song…")
- **Post-checkout polling/success state**: checkout success page polls `getBillingState` for billing-state convergence

## What it does not own

- Demo song content creation/seeding (setup task, not a feature story)
- Billing schema or RPCs — Feature 01
- Billing domain types, env config, provisioning — Feature 02
- Pipeline gating or read-model enforcement — Feature 03
- Billing service endpoints or bridge — Feature 04
- Post-onboarding purchase surfaces (sidebar, settings, paywall, selection UI) — Feature 06

## Likely touchpoints

| Area | Files |
|---|---|
| Onboarding feature | `src/features/onboarding/Onboarding.tsx`, `src/features/onboarding/types.ts` |
| Onboarding components | `src/features/onboarding/components/*` (new step components + `ReadyStep.tsx` update) |
| Onboarding server fns | `src/lib/server/onboarding.functions.ts` |
| Preferences | `src/lib/domains/library/accounts/preferences-queries.ts` (`ONBOARDING_STEPS` enum) |
| Onboarding route | `src/routes/_authenticated/onboarding.tsx` |
| Billing domain | `src/lib/domains/billing/unlocks.ts` (free allocation), `queries.ts` |
| Billing server fns | `src/lib/server/billing.functions.ts` (checkout bridge during plan-selection) |

## Dependencies

- Feature 03 complete (entitlement-safe app; `songs_unlocked` change variant works)
- Feature 04 complete (checkout/portal/bridge plumbing works)
- Pre-seeded demo song available in test/dev environments
- Existing onboarding route and state machine functional

## Downstream stories this feature should split into

1. **Onboarding step enum expansion** — add `song-showcase`, `match-showcase`, `plan-selection` to `ONBOARDING_STEPS`; update step persistence and route loader
2. **Song showcase step component** — displays pre-seeded demo song analysis; no billing interaction
3. **Playlist profiling trigger** — start target-playlist profiling when user saves playlists in `flag-playlists`; ensures profiles ready for match showcase
4. **Match showcase step component** — runs live match for demo song against real playlists; `priority` queue band; timeout fallback to canned result
5. **Plan selection step component** — presents free / pack / unlimited choices; auto-skip when `BILLING_ENABLED=false`; `QUARTERLY_PLAN_ENABLED` flag gates quarterly option
6. **Free allocation on completion** — call `insert_song_unlocks_without_charge` for up to 15 songs when user stays free; emit `BillingChanges.songsUnlocked`
7. **Pack onboarding branch** — initiate pack checkout from plan-selection; handle return/polling; display updated balance and bonus unlocks
8. **Unlimited onboarding branch** — initiate unlimited checkout; show conversion discount if applicable; handle return/polling; display activation state
9. **`ReadyStep` copy update** — billing-aware variants based on onboarding outcome
10. **Provider-disabled onboarding path** — auto-skip `plan-selection`; verify self-hosted unlimited activates full-library processing without regressions
11. **Post-checkout success/polling UX** — poll billing state after Stripe redirect; timeout fallback message

## Definition of done

- Fresh provider-enabled user can complete onboarding into free, pack, or unlimited states; each triggers correct billing primitives
- Fresh provider-disabled user skips `plan-selection` and enters self-hosted unlimited flow
- Free allocation only occurs on the free branch; uses `source='free_auto'`; respects the 15-song limit and forfeiture rules
- Demo song showcase does not create unlock rows or spend credits
- Match showcase completes within ~15s or falls back to canned result
- `ReadyStep` copy reflects the user's actual plan/processing state
- Plan-selection auto-skips when `BILLING_ENABLED=false`
- `QUARTERLY_PLAN_ENABLED=false` hides quarterly option
- Post-checkout polling converges within a reasonable window
- Existing onboarding tests updated; new tests cover each onboarding branch
