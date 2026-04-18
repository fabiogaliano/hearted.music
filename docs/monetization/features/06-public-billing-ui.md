# Feature: Public Billing UI

> **Feature 06** · Dependency: Features 03–04 · Can parallelize with Feature 05 after Feature 04 bridge contracts land

## Goal

Expose the ongoing monetization surfaces users need after onboarding: plan visibility, balance display, song selection for pack users, paywall/upgrade CTAs, and subscription management.

## Why it exists

Onboarding (Feature 05) gets users into the system, but the day-to-day product experience needs its own billing surfaces: seeing plan state in the shell, selecting songs to explore from purchased balance, encountering upgrade prompts when balance hits zero, and managing subscriptions through settings. These touchpoints have different code paths, review loops, and design constraints from onboarding — separating them avoids a monolithic feature.

## What this feature owns

### Shell / account track

- **Billing state in authenticated shell** — route loader reads `BillingState`; passes to layout
- **Sidebar plan display** — dynamic plan label derived from billing state (replaces hardcoded `"Free Plan"`)
- **Sidebar balance display** — shows songs-to-explore count in provider-enabled deployments; hidden when unlimited or provider-disabled
- **Settings/billing section** — plan info, subscription status, manage subscription (portal launch), buy more packs; self-hosted mode shows simple unlimited status with no purchase actions
- **Portal launch** — calls `createPortalSession()` server function; provider-enabled only

### Library commerce track

- **Song selection UI for pack users** — explicit song selection from liked songs; most-recent ordered; selection count + remaining balance confirmation
- **`requestSongUnlock` flow** — calls `requestSongUnlock({ songIds })` server function → `unlock_songs_for_account` RPC → emits `BillingChanges.songsUnlocked`
- **Paywall / upgrade CTA** — shown when purchased balance hits zero; "Explore more songs" with pricing; entry point to pack or unlimited checkout
- **Pack purchase actions hidden while unlimited active** — hide/disable pack entry points when account has active unlimited access
- **Unlimited upgrade discount display** — explain any first-invoice discount from unused purchased pack value before redirect to checkout
- **Post-purchase UI refresh** — cache invalidation after unlock, checkout, or portal return; billing state, liked songs, and stats queries refreshed
- **Locked song states in UI** — liked songs page renders `locked` songs with visual distinction and explore/unlock affordance

### Provider-disabled behavior

- No checkout, portal, balance, or paywall entry points shown
- Unlimited status may be displayed (self-hosted)
- Normal library/product UI remains intact

## What it does not own

- Billing schema or RPCs — Feature 01
- Billing domain types, env config, `BillingState` type — Feature 02
- Pipeline gating, content activation, or read-model entitlement filtering — Feature 03
- Billing service endpoints, Stripe SDK, or bridge — Feature 04
- Onboarding steps or free allocation — Feature 05
- Locked/pending SQL query logic (that's Feature 03); this feature consumes the states Feature 03 produces

## Likely touchpoints

| Area | Files |
|---|---|
| Authenticated layout | `src/routes/_authenticated/route.tsx` |
| Sidebar | `src/routes/_authenticated/-components/Sidebar.tsx` |
| Settings | `src/routes/_authenticated/settings.tsx`, `src/features/settings/SettingsPage.tsx` |
| Liked songs | `src/routes/_authenticated/liked-songs.tsx`, `src/features/liked-songs/*` |
| Dashboard | `src/routes/_authenticated/dashboard.tsx`, `src/features/dashboard/*` (upgrade entry points) |
| Billing server fns | `src/lib/server/billing.functions.ts` (`requestSongUnlock`, `createCheckoutSession`, `createPortalSession`) |
| Query cache | `src/features/liked-songs/queries.ts`, `src/features/dashboard/queries.ts` |

## Dependencies

- Feature 03 complete (billing-aware read models produce `SongDisplayState` values the UI consumes)
- Feature 04 complete (checkout/portal server functions work; bridge triggers control-plane changes)
- Feature 02 complete (`BillingState` type, `getBillingState` server function, offers)

## Downstream stories this feature should split into

### Shell / account track

1. **Billing state in route loader** — load `BillingState` in `_authenticated/route.tsx`; pass to layout context
2. **Dynamic sidebar plan label** — replace hardcoded `"Free Plan"` with plan derived from `BillingState`
3. **Sidebar balance display** — show songs-to-explore count when applicable; hide for unlimited and provider-disabled
4. **Settings billing section** — plan info, subscription status display, portal launch button (provider-enabled), buy-more-packs entry (hidden while unlimited active); self-hosted simplified view
5. **Portal launch integration** — wire portal button to `createPortalSession`; handle redirect

### Library commerce track

6. **Locked song rendering** — liked songs page renders `locked` state with visual distinction and unlock/explore affordance
7. **Song selection UI** — multi-select from liked songs; selection count; remaining balance display; confirmation dialog
8. **`requestSongUnlock` integration** — wire selection UI to server function; handle success (cache invalidation, state update) and error (insufficient balance → paywall)
9. **Paywall / upgrade CTA** — zero-balance prompt with pricing; entry points to pack and unlimited checkout
10. **Pack purchase entry point** — initiate pack checkout; hidden/disabled while unlimited active
11. **Unlimited upgrade entry point** — show conversion discount if applicable; initiate unlimited checkout
12. **Post-purchase cache invalidation** — invalidate billing state, liked songs, and stats queries after unlock, checkout return, or portal return

## Definition of done

- Provider-enabled user sees dynamic plan label and balance in sidebar
- Pack user can select songs, confirm unlock, and see results appear after processing
- Zero-balance state shows paywall with upgrade options
- Unlimited user does not see pack purchase entry points or balance
- Provider-disabled user does not see checkout, portal, balance, or paywall actions
- Settings page shows billing section with subscription management (provider-enabled) or simple status (self-hosted)
- Post-purchase UI correctly reflects updated billing state without stale cache
- Locked songs are visually distinct from pending/analyzed songs on liked songs page
- All provider-enabled purchase flows use the real server function bridges from Feature 04
