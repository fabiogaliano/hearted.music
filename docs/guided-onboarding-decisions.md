# Guided Onboarding — Decisions & Invariants

> **Purpose:** Locked constraints for parallel implementation. Every rule below is derived from `docs/guided-onboarding-plan.md` and `docs/guided-onboarding-terminology.md`. These are not suggestions — they are invariants that implementers must not reinterpret.
>
> **Scope:** This document captures *what is decided*. It does not repeat implementation detail (component trees, CSS specifics). Refer to the plan for those.

---

## 1. Product Invariants

### Walkthrough principle

| Rule | Detail |
|------|--------|
| Real app UI | Walkthrough steps (`song-walkthrough`, `match-walkthrough`) render on real app routes (`/liked-songs`, `/match`) in a constrained mode — not standalone onboarding screens |
| Onboarding gate | Onboarding is not "complete" until the user picks their plan on `plan-selection` |
| App access | User cannot access full app routes until `onboarding_step === 'complete'` |

### Demo song

| Rule | Detail |
|------|--------|
| Entitlement bypass | The demo song bypasses normal entitlement checks during walkthrough — analysis is always visible |
| Non-persistent actions | Walkthrough match actions (Add/Dismiss/Next) do **not** write real `match_decision` rows |
| Source of truth | Demo song identity comes from `walkthroughSong` in route context, populated from `user_preferences.demo_song_id` |

### Match walkthrough data

| Rule | Detail |
|------|--------|
| Live-first, fallback-second | Poll for real demo song matches (~2s interval); fall back to canned data from `demo-matches.ts` after ~12s |
| No-playlists path | If user skipped playlist flagging, canned demo data renders immediately |
| Single action exits | Any action (Add/Dismiss/Next) advances to `plan-selection` — no pagination in walkthrough |

---

## 2. Architecture Invariants

### Step resolver

| Rule | Detail |
|------|--------|
| Location | Pure module at `src/features/onboarding/step-resolver.ts` |
| Single source of truth | Auth gate and layout both consult this resolver — no ad-hoc route whitelists |
| API | `resolveStep(step: OnboardingStep): ResolvedStep` and `isPathAllowed(pathname, resolved): boolean` |

### Step-to-route mapping

| Step | Allowed Route | Onboarding Mode |
|------|---------------|-----------------|
| `song-walkthrough` | `/liked-songs` | `walkthrough` |
| `match-walkthrough` | `/match` | `walkthrough` |
| All others | `/onboarding` | `steps` |

### Route context

| Field | Type | Description |
|-------|------|-------------|
| `onboardingMode` | `"complete" \| "steps" \| "walkthrough"` | UI rendering mode |
| `walkthroughSong` | `WalkthroughSong \| null` | Demo song for walkthrough steps |

### Navigation helpers

| Helper | Scope | Use for |
|--------|-------|---------|
| `useOnboardingNavigation()` | `/onboarding` only | Step-to-step within onboarding shell |
| `useStepNavigation()` | Cross-surface | Walkthrough transitions (`/onboarding` ↔ `/liked-songs` ↔ `/match`) |

### Auth gate behavior

| Condition | Behavior |
|-----------|----------|
| `isComplete === true` | No route restrictions, `onboardingMode: "complete"`, sidebar visible |
| `isComplete === false` | Enforce `isPathAllowed()`, set `onboardingMode` from resolver, sidebar hidden |
| Disallowed path attempted | Redirect to `resolved.allowedPath` (silent redirect, no toast) |

---

## 3. Data Model Invariants

### Onboarding state

| Rule | Detail |
|------|--------|
| Source of truth | `user_preferences.onboarding_step` (DB) |
| Completion derivation | `isComplete = (onboarding_step === 'complete')` — no separate boolean field |
| `markOnboardingComplete()` | Sets `onboarding_step = 'complete'` |

### WalkthroughSong shape

```ts
type WalkthroughSong = {
  id: string;           // song.id
  spotifyTrackId: string; // song.spotify_id
  slug: string;         // generated via generateSongSlug()
  name: string;         // song.name
  artist: string;       // song.artists[0] ?? "Unknown Artist"
  album: string | null; // song.album_name
  albumArtUrl: string | null; // song.image_url
};
```

### Step enum values (frozen)

```ts
export const ONBOARDING_STEPS = z.enum([
  "welcome",
  "pick-color",
  "install-extension",
  "syncing",
  "flag-playlists",
  "pick-demo-song",
  "song-walkthrough",
  "match-walkthrough",
  "plan-selection",
  "complete",
]);
```

---

## 4. UI / Interaction Invariants

### Sidebar visibility

| Mode | Sidebar |
|------|---------|
| `onboardingMode === "complete"` | Visible |
| `onboardingMode === "steps"` | Hidden |
| `onboardingMode === "walkthrough"` | Hidden |

### Song walkthrough (`/liked-songs`)

| Element | Behavior |
|---------|----------|
| Demo song card | Full opacity, pulse animation (RD-6), interactive |
| Real song cards | `opacity-50`, `pointer-events-none`, no hover states |
| Infinite scroll | Disabled (first page only) |
| Keyboard nav (j/k) | Navigation list filtered to `[demoSong]` only |
| Stats row | Renders normally (real totals) |
| "Unlock Songs" button | Hidden |
| Detail panel auto-open | **No** — user must click demo song |

### Song detail panel (`isWalkthrough === true`)

| Element | Behavior |
|---------|----------|
| Content | Hero + HorizontalJourney + KeyLinesSection only |
| PlaylistsSection | **Hidden** (teaching moment saved for match step) |
| Sticky CTA | `"See where this song belongs →"` — full-width, pinned to bottom |
| CTA click | Save step → navigate to `/match` |

### Match walkthrough (`/match`)

| Element | Behavior |
|---------|----------|
| Layout | Real two-column match UI |
| Loading state | Demo song info (left) + skeleton placeholders (right) |
| Header | Shows "1 of 1", progress bar at 100% |
| Add/Dismiss/Next | All three advance to `plan-selection` (non-persistent) |
| CompletionScreen | Never triggers |

### Plan selection (`plan-selection`)

| State | Renders |
|-------|---------|
| initial | Plan cards (free / pack / unlimited) |
| polling | "Confirming your plan..." |
| retry | Error recovery UI |
| success | "You're in" + stats + tier copy + "Start Exploring →" |

### CTA loading states

| Behavior | Detail |
|----------|--------|
| Visual treatment | `opacity-70` + `pointer-events-none` on click (disable + dim) |
| No spinners | All walkthrough CTAs use disable + dim pattern |
| Double-click prevention | Button disabled immediately on first click |

### Error handling

| Scenario | Behavior |
|----------|----------|
| `saveOnboardingStep()` fails | Toast: `"Something went wrong. Please try again."` — stay on current surface |
| Retry mechanism | Manual — user clicks CTA again |
| Missing `walkthroughSong` | Redirect to `/onboarding?step=pick-demo-song` |

### Keyboard shortcuts

| Scenario | Behavior |
|----------|----------|
| Global nav shortcuts during walkthrough | Let auth gate handle — silent redirect to allowed path |
| Local list nav (j/k) | Filtered to enabled songs only |

### Focus management

| Scenario | Behavior |
|----------|----------|
| Surface transitions | No special focus handling — default browser/router behavior |

### Animations

| Element | Detail |
|---------|--------|
| Demo song pulse | `box-shadow` pulse, 2s duration, infinite until clicked |
| Reduced motion | Static left border only (`3px solid ${theme.primary}`) |
| Transition animations | None — route changes unmount pages, no special exit animations |

---

## 5. Cleanup Invariants

### Components to delete

- `src/features/onboarding/components/SongShowcaseStep.tsx`
- `src/features/onboarding/components/MatchShowcaseStep.tsx`
- `src/features/onboarding/components/ReadyStep.tsx`
- `src/features/onboarding/__tests__/ReadyStep.test.tsx`
- `STEP_CONFIG` entries for `song-walkthrough`, `match-walkthrough`, `ready`

### Enum values to delete

- `song-showcase` (now `song-walkthrough`)
- `match-showcase` (now `match-walkthrough`)
- `ready` (absorbed into `plan-selection` success state)

### Data helpers to keep

- `getDemoSongMatches()` — used by walkthrough `/match`
- `getDemoMatchesForSong()` — canned fallback data
- `demo-matches.ts` — static data module

### Migration

| Environment | Approach |
|-------------|----------|
| Pre-prod | No migration — delete old enum values, affected test accounts restart onboarding |
| Future prod | Would require migration script (out of scope for now) |

---

## 6. Terminology Reference

See `docs/guided-onboarding-terminology.md` for canonical names:

| Term | Canonical Value |
|------|-----------------|
| Onboarding modes | `"complete"`, `"steps"`, `"walkthrough"` |
| Walkthrough steps | `"song-walkthrough"`, `"match-walkthrough"` |
| Route context fields | `onboardingMode`, `walkthroughSong` |
| Navigation hook | `useStepNavigation()` |
| Component props | `SongCard.isEnabled`, `SongDetailPanel.isWalkthrough` |

---

## 7. Non-Goals / Out-of-Scope

| Decision | Rationale |
|----------|-----------|
| Special focus management | Default browser behavior is sufficient for walkthrough |
| Spinner loading states | Disable + dim is lighter, faster-feeling |
| Transition animations | Route changes unmount pages; animating would feel odd |
| Auto-open detail panel | User must learn "click song to see analysis" |
| Persistent walkthrough actions | Match decisions written before onboarding complete would be premature |
| Migration for pre-prod | Test accounts can restart onboarding |

---

## 8. Open Questions

None — all ambiguities resolved during decisions extraction.
