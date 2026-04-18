# Walkthrough Onboarding — Implementation Stories

> **Source of truth:** `docs/guided-onboarding-plan.md`, `docs/guided-onboarding-decisions.md`,
> `docs/guided-onboarding-terminology.md`, `docs/guided-onboarding-phases.md`
>
> **Delivery model:** Single PR on `feat/monetization`. Each story = one commit.
> Stories are ordered by dependency — execute sequentially.

---

## Story Index

| ID | Title | Depends on | Phase |
|----|-------|------------|-------|
| S1 | ~~Enum rename + step resolver~~ ✅ `553590a` | — | 1 |
| S2 | ~~Extend `getOnboardingData` with `walkthroughSong`~~ ✅ `8fd2019` | S1 | 1 |
| S3 | ~~Route context, auth gate, sidebar, layout effects~~ ✅ `8165849` | S1, S2 | 1 |
| S4 | ~~Cross-surface navigation hook (`useStepNavigation`)~~ ✅ `2f23d0c` | S1 | 2b |
| S5 | ~~`PlanSelectionStep` absorbs `ReadyStep`~~ ✅ `9fba0c4` | S1, S3 | 2a |
| S6 | ~~Song walkthrough — component props (`SongCard`, `SongDetailPanel`)~~ ✅ `072a850` | S4 | 3 |
| S7 | ~~Song walkthrough — page wiring + showcase deletion~~ ✅ `5b29c46` | S3, S6 | 3 |
| S8 | ~~Match walkthrough — data adapter, actions, showcase deletion~~ ✅ `419b898` | S4, S7 | 4 |
| S9 | Cleanup and verification | S5, S8 | 5 |

```
S1 ──→ S2 ──→ S3 ──→ S7 ──→ S8 ──→ S9
 │              │                     ↑
 ├──→ S4 ──→ S6 ┘                    │
 │                                    │
 └──→ S5 ─────────────────────────────┘
```

**Critical path:** S1 → S2 → S3 → S7 → S8 → S9

**Parallel branch:** S5 (PlanSelectionStep refactor) can be done after S3 and merged at S9.

---

## S1: Enum rename + step resolver

**Goal:** Rename `song-showcase` → `song-walkthrough`, `match-showcase` → `match-walkthrough` in the step enum. Create the step resolver module with unit tests.

**Depends on:** —
**Blocks:** S2, S3, S4, S5

### Scope

**In scope:**
- Rename enum values in `ONBOARDING_STEPS`
- Fix all downstream string literal references (compile-driven)
- Create `step-resolver.ts` with `resolveStep()`, `isPathAllowed()`, types
- Unit tests for all step → route/mode mappings

**Out of scope:**
- Wiring resolver into auth gate (S3)
- Removing `"ready"` from enum (S5)
- Any UI changes

### Likely Touchpoints

| File | Change |
|------|--------|
| `src/lib/domains/library/accounts/preferences-queries.ts:30-42` | Rename `"song-showcase"` → `"song-walkthrough"`, `"match-showcase"` → `"match-walkthrough"` in `ONBOARDING_STEPS` |
| `src/features/onboarding/Onboarding.tsx:56-101` | Rename `STEP_CONFIG` keys |
| `src/features/onboarding/components/PickDemoSongStep.tsx` | `goToStep("song-showcase")` → `goToStep("song-walkthrough")` |
| `src/features/onboarding/components/SongShowcaseStep.tsx` | `goToStep("match-showcase")` → `goToStep("match-walkthrough")` |
| `src/lib/server/onboarding.functions.ts` | `saveOnboardingStep` phaseJobIds-clear list: update step names |
| `src/features/onboarding/__tests__/onboarding-flow.test.tsx` | Update step name literals |
| `src/features/onboarding/step-resolver.ts` | **New file** — `resolveStep()`, `isPathAllowed()`, `OnboardingMode`, `AllowedPath`, `ResolvedStep` types |
| `tests/` or `src/features/onboarding/__tests__/step-resolver.test.ts` | **New file** — unit tests |

### Constraints and Decisions

- Step resolver is a pure module, no side effects (Decisions §2, Architecture Invariants)
- `ResolvedStep.onboardingMode` is `"steps" | "walkthrough"` — the `"complete"` mode is set by the auth gate, not the resolver (Terminology doc, RD-9)
- `isPathAllowed` does exact match against `resolved.allowedPath` (Decisions §2)
- `"ready"` stays in the enum for this commit — removing it requires PlanSelectionStep changes (S5)

### Acceptance Criteria

- [x] No string literal `"song-showcase"` or `"match-showcase"` in source code
- [x] `ONBOARDING_STEPS` contains `"song-walkthrough"` and `"match-walkthrough"`
- [x] `step-resolver.ts` exports `resolveStep`, `isPathAllowed`, `OnboardingMode`, `ResolvedStep`
- [x] `resolveStep("song-walkthrough")` → `{ allowedPath: "/liked-songs", onboardingMode: "walkthrough" }`
- [x] `resolveStep("match-walkthrough")` → `{ allowedPath: "/match", onboardingMode: "walkthrough" }`
- [x] `resolveStep("welcome")` → `{ allowedPath: "/onboarding", onboardingMode: "steps" }`
- [x] `isPathAllowed("/liked-songs", resolveStep("song-walkthrough"))` → `true`
- [x] `isPathAllowed("/match", resolveStep("song-walkthrough"))` → `false`
- [x] All existing tests pass, app compiles

### Notes

TypeScript compiler will flag every reference to the old enum values after rename — follow the errors. This should be a clean, mechanical rename.

---

## S2: Extend `getOnboardingData` with `walkthroughSong`

**Goal:** Add `walkthroughSong` to the `OnboardingData` return type so route context can expose the demo song identity.

**Depends on:** S1
**Blocks:** S3

### Scope

**In scope:**
- Create `WalkthroughSong` type
- Extend `getOnboardingData()` to read `demo_song_id`, fetch song row, map to `WalkthroughSong`
- Return `walkthroughSong: WalkthroughSong | null`

**Out of scope:**
- Wiring into route context (S3)
- Any UI changes

### Likely Touchpoints

| File | Change |
|------|--------|
| `src/features/onboarding/step-resolver.ts` | Add `WalkthroughSong` type export (co-located with resolver types) |
| `src/lib/server/onboarding.functions.ts:51-84` | Add `walkthroughSong` to `OnboardingData` interface |
| `src/lib/server/onboarding.functions.ts:104+` | In `getOnboardingData()`: read `demo_song_id` from prefs, fetch `song` row by ID, map fields, return `walkthroughSong` |

### Constraints and Decisions

- Field mapping per RD-10 and Decisions §3:
  - `id` ← `song.id`
  - `spotifyTrackId` ← `song.spotify_id`
  - `slug` ← `generateSongSlug()` (existing utility)
  - `name` ← `song.name`
  - `artist` ← `song.artists[0] ?? "Unknown Artist"`
  - `album` ← `song.album_name`
  - `albumArtUrl` ← `song.image_url`
- Return `null` when `demo_song_id` is not set (user hasn't reached pick-demo-song yet)
- Single-row lookup by primary key — negligible perf cost
- `demo_song_id` is already available from `user_preferences` (populated by `saveDemoSongSelection`)

### Acceptance Criteria

- [x] `OnboardingData` type includes `walkthroughSong: WalkthroughSong | null`
- [x] `getOnboardingData()` returns populated `walkthroughSong` when `demo_song_id` is set
- [x] `getOnboardingData()` returns `walkthroughSong: null` when no demo song selected
- [x] `WalkthroughSong` type is exported from `step-resolver.ts`
- [x] App compiles, existing tests pass

### Notes

`getDemoSongShowcase()` already does a similar lookup (reads `demo_song_id`, fetches song + analysis). Reuse the song-fetching pattern but return a lighter shape (no analysis data needed).

---

## S3: Route context, auth gate, sidebar, layout effects

**Goal:** Wire `onboardingMode` and `walkthroughSong` into route context. Update sidebar visibility and layout effect gating to use mode instead of path checks. Remove `ready`-based auto-skip from `/onboarding` beforeLoad.

**Depends on:** S1, S2
**Blocks:** S5, S7

### Scope

**In scope:**
- `_authenticated/route.tsx`: import resolver, compute `onboardingMode`, add to route context
- `_authenticated/route.tsx`: replace auth gate redirect with `isPathAllowed()` check
- `_authenticated/route.tsx`: sidebar conditional → `onboardingMode === "complete"`
- Layout side-effect gating → `onboardingMode === "complete"`
- `/onboarding` route: remove `ready`-based auto-skip logic

**Out of scope:**
- Individual page walkthrough behavior (S6, S7, S8)
- `useStepNavigation` hook (S4)

### Likely Touchpoints

| File | Change |
|------|--------|
| `src/routes/_authenticated/route.tsx:55-86` | Import `resolveStep`, `isPathAllowed`. In `beforeLoad`: if `!isComplete`, call `resolveStep(currentStep)`, check `isPathAllowed`, redirect to `resolved.allowedPath` if disallowed. Add `onboardingMode` and `walkthroughSong` to return. |
| `src/routes/_authenticated/route.tsx:114-130` | Replace `isOnboarding` path check with `onboardingMode` from context for sidebar/shell rendering |
| `src/routes/_authenticated/route.tsx` | Gate layout effects (e.g., `useActiveJobCompletionEffects`, `usePostPurchaseReturn`) behind `onboardingMode === "complete"` |
| `src/routes/_authenticated/onboarding.tsx` | Remove `isAutoSkipPlanSelection` logic, remove `ready`-based redirect for billing-disabled |

### Constraints and Decisions

- Auth gate behavior per Decisions §2, Architecture Invariants:
  - `isComplete === true` → no resolver call, `onboardingMode: "complete"`, no route restrictions
  - `isComplete === false` → resolve step, enforce `isPathAllowed`, set `onboardingMode` from resolver
  - Disallowed path → redirect to `resolved.allowedPath` (silent, no toast — Decisions §4)
- `isComplete` is derived from `onboarding_completed_at IS NOT NULL` (existing `isOnboardingComplete()`)
- Sidebar: `onboardingMode === "complete"` → visible, all other modes → hidden (Decisions §4)
- `plan-selection` must remain reachable regardless of `BILLING_ENABLED` (RD-7)

### Acceptance Criteria

- [x] Route context includes `onboardingMode: OnboardingMode` and `walkthroughSong: WalkthroughSong | null`
- [x] Completed users: no route restrictions, sidebar visible, `onboardingMode === "complete"`
- [x] Incomplete users on disallowed path: redirected to `resolved.allowedPath`
- [x] `song-walkthrough` step allows `/liked-songs`, blocks all other paths
- [x] `match-walkthrough` step allows `/match`, blocks all other paths
- [x] Standard onboarding steps still redirect to `/onboarding`
- [x] Sidebar hidden during `"steps"` and `"walkthrough"` modes
- [x] Layout effects suppressed when `onboardingMode !== "complete"`
- [x] No `ready`-based auto-skip or billing redirect in `/onboarding` beforeLoad
- [x] App compiles, existing tests pass

### Notes

**Important:** The auth gate redirect change activates walkthrough routing for BOTH `song-walkthrough` and `match-walkthrough` at once. Since users can only reach `match-walkthrough` through song walkthrough's CTA, this is safe even though the match page walkthrough UI isn't built yet (S8). During development, if a user somehow reaches `/match` in walkthrough mode, they'll see the normal (likely empty) match UI — acceptable transient state.

Finding from exploration: `isOnboarding` is currently a path check (`location.pathname.startsWith("/onboarding")`). This path check is used for sidebar visibility and layout effect gating. Both must switch to `onboardingMode` in this commit.

---

## S4: Cross-surface navigation hook (`useStepNavigation`)

**Goal:** Create the `useStepNavigation()` hook that walkthrough transitions use to save step, sync cache, and navigate to the resolver-determined route.

**Depends on:** S1
**Blocks:** S6, S8

### Scope

**In scope:**
- Create `useStepNavigation()` hook
- Save step → cache sync → resolve → navigate flow
- Error handling (toast + stay put)
- Tests

**Out of scope:**
- Wiring into consumer components (S6, S7, S8 do that)
- Modifying `useOnboardingNavigation` (stays as-is)

### Likely Touchpoints

| File | Change |
|------|--------|
| `src/features/onboarding/hooks/useStepNavigation.ts` | **New file** |
| Test file for the hook | **New file** |

### Constraints and Decisions

- Implementation per RD-13 + RD-14 + Decisions §2, §4:
  1. `await saveOnboardingStep({ data: { step: nextStep } })`
  2. `queryClient.setQueryData(["auth", "onboarding"], (prev) => prev ? { ...prev, currentStep: nextStep } : prev)`
  3. `queryClient.invalidateQueries({ queryKey: ["auth", "onboarding"] })` (non-blocking)
  4. `const resolved = resolveStep(nextStep)`
  5. Navigate: `/onboarding?step=...` or `resolved.allowedPath`
  6. On save failure: `toast.error("Something went wrong. Please try again.")` — no navigation
- Cache sync is required before navigation — `ensureQueryData` with non-zero staleTime in `_authenticated/route.tsx` would otherwise use stale `currentStep` (RD-14)
- `useOnboardingNavigation()` stays as-is for `/onboarding`-scoped steps (Decisions §2)
- Navigation uses `useRouter().navigate()` for absolute path navigation (not `useNavigate({ from })`)

### Acceptance Criteria

- [x] `useStepNavigation()` exported from `hooks/useStepNavigation.ts`
- [x] `navigateTo("song-walkthrough")` saves step, syncs cache, navigates to `/liked-songs`
- [x] `navigateTo("plan-selection")` saves step, syncs cache, navigates to `/onboarding?step=plan-selection`
- [x] Save failure → error toast, no navigation, no cache update
- [x] Hook is importable by Phase 3/4 consumers
- [x] Tests cover success and failure paths

### Notes

Reference `useOnboardingNavigation` at `src/features/onboarding/hooks/useOnboardingNavigation.ts` for patterns (query client access, `saveOnboardingStep` usage). Key difference: this hook navigates to absolute paths via the resolver instead of using search params.

---

## S5: `PlanSelectionStep` absorbs `ReadyStep`

**Goal:** Merge `ReadyStep` content into `PlanSelectionStep` as an internal `success` state. Remove `"ready"` step from the enum. Delete `ReadyStep.tsx`.

**Depends on:** S1, S3
**Blocks:** S9

### Scope

**In scope:**
- Add `success` internal state to `PlanSelectionStep`
- Absorb `ReadyStep` content (overline, headline, stats, tier copy, CTA)
- Add `syncStats` and `readyCopyVariant` props via `STEP_CONFIG`
- Replace `goToStep("ready")` with internal state transitions
- Billing-disabled contract: render `success` immediately
- Delete `ReadyStep.tsx`, test, `STEP_CONFIG.ready`, `"ready"` from enum
- Remove timer-based auto-navigation after checkout confirmation

**Out of scope:**
- Walkthrough-specific changes (S6–S8)

### Likely Touchpoints

| File | Change |
|------|--------|
| `src/features/onboarding/components/PlanSelectionStep.tsx` | Add internal state machine (`initial` / `polling` / `retry` / `success`). Add `syncStats` + `readyCopyVariant` props. Replace `goToStep("ready")` → set state to `success`. Add success render (content from ReadyStep). Add billing-disabled branch. Remove 2s timer delay. |
| `src/features/onboarding/Onboarding.tsx:56-101` | Wire `STEP_CONFIG["plan-selection"]` to pass `ctx.syncStats` and `ctx.readyCopyVariant` as props. Delete `STEP_CONFIG.ready`. |
| `src/lib/domains/library/accounts/preferences-queries.ts:30-42` | Remove `"ready"` from `ONBOARDING_STEPS` enum |
| `src/lib/server/onboarding.functions.ts` | Remove `"ready"`-specific branches in `saveOnboardingStep` |
| `src/features/onboarding/components/ReadyStep.tsx` | **Delete** |
| `src/features/onboarding/__tests__/ReadyStep.test.tsx` | **Delete** |
| `src/features/onboarding/__tests__/onboarding-flow.test.tsx` | Remove `ready`-specific assertions |

### Constraints and Decisions

- Success state content per RD-7 and Decisions §4:
  - Overline: `Complete`
  - Headline: `You're in.`
  - Stats: `{syncStats.songs} Songs` / `{syncStats.playlists} Playlists`
  - Tier copy from `READY_COPY[readyCopyVariant]` (free/pack/unlimited variants)
  - CTA: `"Start Exploring →"` with Enter keyboard shortcut
  - CTA handler: `markOnboardingComplete()` → optimistic cache update → navigate `/dashboard`
- CTA loading state: disable + dim, no spinner (Decisions §4)
- Checkout confirmation gate (RD-7):
  - `Start Exploring` NOT shown for paid flows until billing confirmation succeeds
  - Free path + billing-disabled → `success` immediately
- Retry state (RD-7):
  - `Retry confirmation` (restart polling)
  - `Choose a different plan` (return to `initial`)
  - Never calls `markOnboardingComplete()` directly
- `readyCopyVariant` sourced from `OnboardingData` (server-derived, refresh-safe) — Decisions §4
- Keep `ReadyCopyVariant` type export in `onboarding.functions.ts` (still used by `PlanSelectionStep`)
- Keep `READY_COPY` constant — move from ReadyStep to PlanSelectionStep

### Acceptance Criteria

- [x] `PlanSelectionStep` has four internal states: `initial`, `polling`, `retry`, `success`
- [x] Free plan selected → `success` state (no navigation to `ready`)
- [x] Stripe confirmed → `success` state immediately (no 2s timer)
- [x] Stripe timeout → `retry` state with two actions
- [x] Billing-disabled → `success` renders immediately (free-tier copy)
- [x] Success state shows overline, headline, stats, tier copy, CTA
- [x] `Start Exploring →` calls `markOnboardingComplete()` → navigates to `/dashboard`
- [x] CTA shows disable + dim on click (no spinner)
- [x] `ReadyStep.tsx` and test deleted
- [x] `"ready"` removed from `ONBOARDING_STEPS` enum — no compilation errors
- [x] No string literal `"ready"` remains in source code (except docs)
- [x] `STEP_CONFIG` has no `ready` entry
- [x] App compiles, existing tests pass (with ready-specific tests removed/updated)

### Notes

Finding from exploration: `ReadyStep` uses `markOnboardingComplete()` + direct `navigate({ to: "/dashboard" })` — it does NOT use `useOnboardingNavigation`. The success state in `PlanSelectionStep` should replicate this pattern exactly. `markOnboardingComplete()` sets `onboarding_completed_at` timestamp (the actual completion signal), not `onboarding_step`.

Also: the current auto-skip for billing-disabled lives in the `/onboarding` route `beforeLoad`, not in `PlanSelectionStep`. S3 removes that route-level skip. This story adds the component-level billing-disabled awareness via `getPlanSelectionConfig()`.

---

## S6: Song walkthrough — component props (`SongCard`, `SongDetailPanel`)

**Goal:** Add walkthrough props to `SongCard` and `SongDetailPanel`. No page-level wiring yet — just the component-level changes.

**Depends on:** S4
**Blocks:** S7

### Scope

**In scope:**
- `SongCard`: `isEnabled` prop (default `true`), `isWalkthroughHighlight` prop
- Disabled state: `opacity-50`, `pointer-events-none`, no hover
- Pulse animation: `box-shadow` keyframes, `prefers-reduced-motion` fallback
- `SongDetailPanel`: `isWalkthrough` prop (default `false`)
- `PanelContent`: walkthrough mode (hide `PlaylistsSection`, add sticky CTA)
- Sticky CTA: "See where this song belongs →", `useStepNavigation` click handler

**Out of scope:**
- `LikedSongsPage` walkthrough mode wiring (S7)
- `/liked-songs` route changes (S7)

### Likely Touchpoints

| File | Change |
|------|--------|
| `src/features/liked-songs/components/SongCard.tsx` | Add `isEnabled?: boolean` (default `true`) and `isWalkthroughHighlight?: boolean` props. When `!isEnabled`: `opacity-50 + pointer-events-none + no hover`. When `isWalkthroughHighlight`: left border + pulse animation. |
| `src/features/liked-songs/components/SongDetailPanel.tsx` | Add `isWalkthrough?: boolean` prop. When `true`: force `displayState` to unlocked, pass `isWalkthrough` to `PanelContent`. |
| `src/features/liked-songs/components/detail/PanelContent.tsx` | Add `isWalkthrough?: boolean` prop. When `true`: hide `PlaylistsSection`, render sticky footer CTA. |

### Constraints and Decisions

- SongCard disabled state per RD-16 and Decisions §4:
  - `opacity-50` + `pointer-events-none` + no hover states
  - No grayscale filter
- Pulse animation per RD-6 and Decisions §4:
  - `@keyframes walkthrough-pulse { 0%,100%: transparent; 50%: box-shadow 0 0 12px ${theme.primary}40 }`
  - 2s duration, ease-in-out, infinite
  - Static left border: `3px solid ${theme.primary}`
  - `prefers-reduced-motion: reduce` → static border only
  - Stops when card is clicked (transitions to selected state)
- Detail panel walkthrough mode per RD-2 and Decisions §4:
  - Render `Hero + HorizontalJourney + KeyLinesSection` only
  - Hide `PlaylistsSection`
  - Force unlocked (bypass entitlement)
- Sticky CTA per RD-2:
  - Copy: `"See where this song belongs →"`
  - Full-width primary-theme native `<button>`, pinned to panel bottom
  - `aria-label` matches visible text
  - Click: `useStepNavigation().navigateTo("match-walkthrough")`
  - Loading: disable + dim (Decisions §4, CTA loading states)

### Acceptance Criteria

- [x] `SongCard` with `isEnabled={false}` renders with `opacity-50`, no pointer events, no hover
- [x] `SongCard` with `isWalkthroughHighlight={true}` shows left border + pulse animation
- [x] `prefers-reduced-motion` → pulse replaced with static border
- [x] `SongCard` with no new props → unchanged behavior (defaults: `isEnabled=true`, `isWalkthroughHighlight=false`)
- [x] `SongDetailPanel` with `isWalkthrough={true}` forces unlocked display state
- [x] `PanelContent` with `isWalkthrough={true}` hides `PlaylistsSection`
- [x] Sticky CTA renders at panel bottom with correct copy
- [x] CTA click calls `navigateTo("match-walkthrough")`
- [x] CTA shows disable + dim on click
- [x] App compiles, existing tests pass

### Notes

`SongCard` currently has many props (see exploration report). The new props are additive and optional with safe defaults — no risk to existing call sites.

For the pulse animation, check if the theme primary color is available via CSS variable or if it needs to be passed as a prop. The codebase likely has a `useTheme()` hook or CSS variables for `theme.primary`.

---

## S7: Song walkthrough — page wiring + showcase deletion

**Goal:** Wire `LikedSongsPage` to render walkthrough mode. Update `/liked-songs` route. Switch `PickDemoSongStep` to `useStepNavigation`. Delete `SongShowcaseStep`.

**Depends on:** S3, S6
**Blocks:** S8

### Scope

**In scope:**
- `LikedSongsPage`: walkthrough mode (spotlight list, disabled infinite scroll, filtered keyboard nav)
- `/liked-songs` route: pass `onboardingMode` + `walkthroughSong` from context
- Synthetic `LikedSong` construction from `WalkthroughSong`
- Fail-soft guard: missing `walkthroughSong` → redirect to `pick-demo-song`
- `PickDemoSongStep` → use `useStepNavigation` for `song-walkthrough` transition
- Delete `SongShowcaseStep.tsx` + related test/story files
- Update `STEP_CONFIG["song-walkthrough"]`

**Out of scope:**
- Match walkthrough (S8)

### Likely Touchpoints

| File | Change |
|------|--------|
| `src/features/liked-songs/LikedSongsPage.tsx` | Add `onboardingMode` and `walkthroughSong` props. Derive `isWalkthrough`. When walkthrough: build synthetic `LikedSong` from `walkthroughSong` at position 0, de-dup, disable infinite scroll, filter keyboard nav list, hide Unlock button + selection mode, set `isEnabled`/`isWalkthroughHighlight` per song. |
| `src/routes/_authenticated/liked-songs.tsx` | Pass `onboardingMode` and `walkthroughSong` from `Route.useRouteContext()`. In walkthrough mode: skip or limit loader prefetch to first page only. |
| `src/features/onboarding/components/PickDemoSongStep.tsx` | Replace `goToStep("song-walkthrough")` → `useStepNavigation().navigateTo("song-walkthrough")` |
| `src/features/onboarding/components/SongShowcaseStep.tsx` | **Delete** |
| `src/features/onboarding/components/SongShowcaseStep.stories.tsx` | **Delete** |
| `src/features/onboarding/Onboarding.tsx` | Update `STEP_CONFIG["song-walkthrough"]`: `{ render: () => null, hideIndicator: true }` — step no longer renders on `/onboarding` |

### Constraints and Decisions

- Spotlight pattern per RD-16 and Decisions §4:
  1. Fetch first page of real liked songs (standard query, no infinite scroll continuation)
  2. Build synthetic `LikedSong` from `walkthroughSong` with `displayState: "unlocked"`
  3. De-duplicate: remove real song with same `song.id` as demo
  4. Prepend demo at position 0
  5. `isEnabled = song.track.id === walkthroughSong.id`
- Page chrome per RD-17 and Decisions §4:
  - Header + stats row: visible, real totals
  - Unlock button: hidden
  - Selection mode: hidden
  - Infinite scroll: disabled
  - Keyboard nav: `useListNavigation([demoSong])` only
- Initial entry behavior per RD-10, RD-11:
  - Panel closed on entry (no `?song=` in URL)
  - User clicks demo song → existing panel mechanics open + set `?song=slug`
  - Refresh with `?song=slug` → reopen panel
- Fail-soft per RD-16, Decisions §4:
  - `onboardingMode === "walkthrough" && walkthroughSong === null` → redirect to `/onboarding?step=pick-demo-song`

### Acceptance Criteria

- [x] `song-walkthrough` step routes user to `/liked-songs` (not `/onboarding`)
- [x] Demo song renders at top, full opacity, with pulse animation
- [x] Real songs render below, greyed (`opacity-50`, non-interactive)
- [x] Clicking demo song opens detail panel with analysis (no lock gate)
- [x] `PlaylistsSection` hidden in walkthrough panel
- [x] Sticky CTA "See where this song belongs →" at panel bottom
- [x] CTA click → saves `match-walkthrough` → navigates to `/match`
- [x] Detail panel does NOT auto-open on entry
- [x] `?song=` not set in URL on initial walkthrough entry
- [x] Refresh on `/liked-songs` during `song-walkthrough` → restores walkthrough state
- [x] Refresh with `?song=<slug>` → reopens detail panel
- [x] Missing `walkthroughSong` → redirect to `pick-demo-song`
- [x] Keyboard nav limited to demo song only
- [x] Infinite scroll disabled
- [x] Stats row shows real totals
- [x] Sidebar hidden
- [x] `SongShowcaseStep.tsx` deleted
- [x] Edge: 0 liked songs → only demo song shown
- [x] Edge: demo song in liked songs → de-duplicated, shown once

### Notes

Synthetic `LikedSong` construction: the `LikedSong` type includes `track.*` fields and metadata like `liked_at`, `displayState`. Build a helper that creates a minimal but type-safe object from `WalkthroughSong`. Set `displayState: "unlocked"` to bypass all lock checks downstream.

`getDemoSongShowcase()` may become unreferenced after this deletion — verify and remove in S9 if so.

---

## S8: Match walkthrough — data adapter, actions, showcase deletion

**Goal:** Wire `/match` to render walkthrough mode with a data adapter (live poll + canned fallback), non-persistent action handlers, and walkthrough-specific loading state. Delete `MatchShowcaseStep`.

**Depends on:** S4, S7
**Blocks:** S9

### Scope

**In scope:**
- Match page walkthrough branch (route + component)
- Walkthrough data adapter (poll `getDemoSongMatches()`, fallback to `getDemoMatchesForSong()`)
- Non-persistent action handlers (all → `navigateTo("plan-selection")`)
- Loading skeleton (song info left, skeleton placeholders right)
- Header: "1 of 1", progress 100%
- Fail-soft guard: missing `walkthroughSong` → redirect to `pick-demo-song`
- Delete `MatchShowcaseStep.tsx` + related test/story files
- Update `STEP_CONFIG["match-walkthrough"]`

**Out of scope:**
- Song walkthrough (S7 — done)
- PlanSelectionStep changes (S5 — independent)

### Likely Touchpoints

| File | Change |
|------|--------|
| `src/routes/_authenticated/match.tsx` | Read `onboardingMode` + `walkthroughSong` from route context. When walkthrough: skip normal `matchingSessionQueryOptions` prefetch, render walkthrough adapter instead of `<Matching />`. |
| `src/features/matching/` or `src/features/onboarding/components/` | **New component** — walkthrough match adapter (data fetching + UI wiring). Reuses real matching UI components with overridden action handlers. |
| `src/features/onboarding/components/MatchShowcaseStep.tsx` | **Delete** |
| `src/features/onboarding/components/MatchShowcaseStep.stories.tsx` | **Delete** |
| `src/features/onboarding/Onboarding.tsx` | Update `STEP_CONFIG["match-walkthrough"]`: `{ render: () => null, hideIndicator: true }` |

### Constraints and Decisions

- Data adapter per RD-3 and Decisions §1:
  - Poll `getDemoSongMatches()` every ~2s
  - If `status === "ready"` → use live matches
  - If 12s timeout → `getDemoMatchesForSong(walkthroughSong.spotifyTrackId)` canned data
  - No-playlists path → canned data immediately (`getDemoSongMatches` returns `unavailable`)
- Non-persistent actions per RD-3 and Decisions §1:
  - Add, Dismiss, Next all call `useStepNavigation().navigateTo("plan-selection")`
  - NO calls to `addSongToPlaylist()` or `dismissSong()`
  - ALL action entry points (buttons + keyboard shortcuts) route through walkthrough handler
  - Invariant: when walkthrough mode, zero code paths reach real mutation RPCs
- CTA loading: disable + dim on all action buttons (Decisions §4)
- Loading state per RD-12:
  - Left: demo song info from `walkthroughSong` (no fetch)
  - Right: skeleton placeholders
- Page chrome per RD-3:
  - Header: "1 of 1", progress 100%
  - `CompletionScreen` never triggers
- Fail-soft per RD-3, Decisions §4:
  - Missing `walkthroughSong` → redirect to `/onboarding?step=pick-demo-song`

### Acceptance Criteria

- [x] `match-walkthrough` step routes to `/match` with walkthrough UI
- [x] Demo song info renders immediately in left column (from route context, no fetch)
- [x] Skeleton placeholders render in right column during loading
- [x] Match results appear (live poll or canned fallback after 12s)
- [x] No-playlists path → canned data renders immediately
- [x] Any action (Add/Dismiss/Next) → saves `plan-selection` → navigates to `/onboarding?step=plan-selection`
- [x] No real `addSongToPlaylist` or `dismissSong` calls during walkthrough
- [x] Keyboard shortcuts for match actions route through walkthrough handler
- [x] Header shows "1 of 1", progress at 100%
- [x] `CompletionScreen` never renders
- [x] Missing `walkthroughSong` → redirect to `pick-demo-song`
- [x] Sidebar hidden
- [x] `MatchShowcaseStep.tsx` deleted
- [x] Refresh on `/match` during `match-walkthrough` → restores walkthrough state
- [x] Action buttons show disable + dim on click

### Notes

The real matching UI components (`MatchingHeader`, `SongSection`, `MatchesSection`) may need props adapted to work with the walkthrough data shape. `getDemoSongMatches()` returns `DemoMatchPlaylist[]` which has `{ id, name, description, songCount, score }` — verify compatibility with what `MatchesSection` expects. A thin mapping layer may be needed.

`getDemoMatchesForSong()` is currently imported on the client in `MatchShowcaseStep` (the static data ships to the browser). The walkthrough adapter can reuse this pattern.

---

## S9: Cleanup and verification

**Goal:** Remove all remnants of old showcase/ready architecture. Verify complete flow. Ensure test coverage.

**Depends on:** S5, S8
**Blocks:** —

### Scope

**In scope:**
- Verify zero references to `"song-showcase"`, `"match-showcase"`, `"ready"` in source
- Delete orphaned code (`getDemoSongShowcase`, `DemoSongData` if unreferenced)
- Delete orphaned keyboard scopes (`"onboarding-song-showcase"`, `"onboarding-match-showcase"`)
- Verify `StepIndicator` excludes walkthrough steps from dots
- Verify `STEP_CONFIG` entries for `song-walkthrough`/`match-walkthrough` are `{ render: () => null, hideIndicator: true }`
- Test coverage audit
- End-to-end flow verification

**Out of scope:**
- New feature work

### Likely Touchpoints

| File | Change |
|------|--------|
| `src/lib/server/onboarding.functions.ts` | Delete `getDemoSongShowcase()` and `DemoSongData` if only referenced by deleted showcase components |
| Various test files | Add/update tests for step resolver, auth gate routing, walkthrough pages, PlanSelectionStep states |
| Keyboard scope files | Remove showcase-specific scopes if present |
| `src/features/onboarding/Onboarding.tsx` | Verify `INDICATOR_STEPS` filter excludes walkthrough steps |

### Constraints and Decisions

- Keep `getDemoSongMatches()`, `getDemoMatchesForSong()`, `demo-matches.ts` — still used by walkthrough `/match` (Decisions §5)
- Keep `ReadyCopyVariant` type export — still used by `PlanSelectionStep` (RD-7)
- Pre-prod: no SQL migration needed (Decisions §5)

### Acceptance Criteria

- [ ] Zero references to `"song-showcase"`, `"match-showcase"`, `"ready"` in source code
- [ ] Zero imports of deleted component files
- [ ] `getDemoSongShowcase` deleted if unreferenced
- [ ] All new modules have unit tests (step resolver, `useStepNavigation`, PlanSelectionStep states)
- [ ] Auth gate routing tested for all onboarding modes
- [ ] Full onboarding flow verified end-to-end:
  `welcome → pick-color → install-extension → syncing → flag-playlists → pick-demo-song → song-walkthrough (/liked-songs) → match-walkthrough (/match) → plan-selection (/onboarding) → complete → /dashboard`
- [ ] Refresh/resume works at every walkthrough step
- [ ] Back button during walkthrough → silent redirect to allowed path
- [ ] No keyboard shortcut or layout effect leaks between modes
- [ ] Sidebar transitions correctly: hidden → hidden → visible
