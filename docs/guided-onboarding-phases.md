# Walkthrough Onboarding — Implementation Phases

> **Source of truth:** `docs/guided-onboarding-plan.md`, `docs/guided-onboarding-decisions.md`,
> `docs/guided-onboarding-terminology.md`
>
> Phases are ordered by implementation dependency, not by plan section.
> Each phase produces working, testable output before the next phase begins.

---

## Dependency Graph

```
Phase 1: Foundation Contracts
    │
    ├──→ Phase 2a: PlanSelectionStep Absorbs ReadyStep  ─┐
    │                                                     ├──→ Phase 3: Song Walkthrough
    └──→ Phase 2b: Cross-Surface Navigation Hook  ───────┘         │
                                                                   ↓
                                                           Phase 4: Match Walkthrough
                                                                   │
                                                                   ↓
                                                           Phase 5: Cleanup & Verification
```

**Critical serial path:** `1 → 2b → 3 → 4 → 5`

**Parallelizable branch:** `2a` runs alongside `2b` — they share Phase 1 as input but touch
no overlapping files.

---

## Shared Contracts (must land in Phase 1 before any parallel work)

| Contract | Location | Consumers |
|----------|----------|-----------|
| `OnboardingStep` type (renamed values, no `ready`) | `preferences-queries.ts` | Everything |
| `ResolvedStep` type + `resolveStep()` + `isPathAllowed()` | `step-resolver.ts` (new) | Auth gate, `useStepNavigation` |
| `WalkthroughSong` type | `step-resolver.ts` or co-located types | Auth gate context, liked-songs, match |
| `walkthroughSong` field in `getOnboardingData()` return | `onboarding.functions.ts` | Auth gate → route context |
| `onboardingMode` in route context | `_authenticated/route.tsx` | Sidebar, layout effects, liked-songs, match |

---

## Phase 1: Foundation Contracts

**Goal:** Establish the type system, step resolver, route context shape, and sidebar/layout
behavior that all subsequent phases depend on. No routing behavior changes — the auth gate
still redirects all incomplete-onboarding users to `/onboarding`.

**Why this exists:** Every downstream phase reads `onboardingMode`, `walkthroughSong`, or the
resolver. These shared contracts must be stable and tested before any walkthrough UI or
PlanSelectionStep refactoring can begin.

### Inputs / Dependencies

- Current `ONBOARDING_STEPS` enum with `song-showcase`, `match-showcase`, `ready`
- Current auth gate with binary `isOnboardingRoute` path check
- Current sidebar rendered via `!isOnboarding` (path-based)

### Outputs

- Renamed step enum: `song-showcase` → `song-walkthrough`, `match-showcase` → `match-walkthrough`
- `step-resolver.ts` module (pure, unit-tested)
- `WalkthroughSong` type
- `getOnboardingData()` returns `walkthroughSong: WalkthroughSong | null`
- Route context includes `onboardingMode` and `walkthroughSong`
- Sidebar conditional uses `onboardingMode === "complete"` (not path)
- Layout side-effects gated behind `onboardingMode === "complete"`

### Key Touchpoints

**1. Rename enum values in `src/lib/domains/library/accounts/preferences-queries.ts`:**

```
"song-showcase"  → "song-walkthrough"
"match-showcase" → "match-walkthrough"
```

`"ready"` stays in the enum for Phase 1 — removing it requires PlanSelectionStep changes (Phase 2a).

**2. Rename all downstream references** (compile-driven — TypeScript will flag every site):

| File | Change |
|------|--------|
| `src/features/onboarding/Onboarding.tsx` | Rename `STEP_CONFIG` keys: `"song-showcase"` → `"song-walkthrough"`, `"match-showcase"` → `"match-walkthrough"`. Components stay temporarily: `<SongShowcaseStep />`, `<MatchShowcaseStep />` |
| `src/features/onboarding/components/PickDemoSongStep.tsx` | `goToStep("song-showcase")` → `goToStep("song-walkthrough")` |
| `src/features/onboarding/components/SongShowcaseStep.tsx` | `goToStep("match-showcase")` → `goToStep("match-walkthrough")` |
| `src/lib/server/onboarding.functions.ts` | `saveOnboardingStep` phaseJobIds-clear list: update step names |
| Test files referencing old step names | Update string literals |

**3. Create `src/features/onboarding/step-resolver.ts`:**

```ts
type OnboardingMode = "complete" | "steps" | "walkthrough";
type AllowedPath = "/onboarding" | "/liked-songs" | "/match";

type ResolvedStep = {
  allowedPath: AllowedPath;
  onboardingMode: "steps" | "walkthrough";
};

function resolveStep(step: OnboardingStep): ResolvedStep;
function isPathAllowed(pathname: string, resolved: ResolvedStep): boolean;
```

Mapping per terminology doc. Pure functions, no side effects, directly unit-testable.

**4. Create `WalkthroughSong` type** (co-located with resolver or in a shared types file):

```ts
type WalkthroughSong = {
  id: string;
  spotifyTrackId: string;
  slug: string;
  name: string;
  artist: string;
  album: string | null;
  albumArtUrl: string | null;
};
```

**5. Extend `getOnboardingData()` in `src/lib/server/onboarding.functions.ts`:**

- Read `demo_song_id` from `user_preferences` (already available in the query)
- If non-null, fetch the `song` row by ID from the `song` table
- Map to `WalkthroughSong` shape using field mapping from RD-10
- `slug` generated via `generateSongSlug()` (existing utility)
- Return `walkthroughSong: WalkthroughSong | null` alongside existing fields

**6. Update `_authenticated/route.tsx` route context:**

In `beforeLoad`, after loading onboarding data:

- Import and call `resolveStep(onboarding.currentStep)`
- Compute `onboardingMode`:
  - `onboarding.isComplete === true` → `"complete"`
  - Otherwise → `resolved.onboardingMode` (`"steps"` or `"walkthrough"`)
- Add to return: `{ ...existing, onboardingMode, walkthroughSong: onboarding.walkthroughSong }`
- **Do NOT change the redirect logic yet** — keep the existing `!isComplete && !isOnboardingRoute → redirect to /onboarding`. Phase 3 will switch to `isPathAllowed()`.

**7. Update sidebar in `_authenticated/route.tsx` (AuthenticatedShell):**

Replace:
```tsx
{!isOnboarding && <Sidebar ... />}
```
With:
```tsx
{onboardingMode === "complete" && <Sidebar ... />}
```

Read `onboardingMode` from `Route.useRouteContext()`.

**8. Gate layout side-effects:**

Replace any `location.pathname.startsWith("/onboarding")` checks for layout effects
(e.g., `useActiveJobCompletionEffects`, `usePostPurchaseReturn`) with
`onboardingMode === "complete"` gating.

**9. Remove `ready`-based auto-skip in `/onboarding` route `beforeLoad`:**

- Remove `isAutoSkipPlanSelection` logic
- Remove `if (search.step === "plan-selection" && !env.BILLING_ENABLED) → redirect to step: "ready"`
- Keep `plan-selection` always reachable regardless of `BILLING_ENABLED`

### Parallelism Within Phase

Limited. The enum rename must land first (everything type-checks against it). After that:
- `step-resolver.ts` creation and `getOnboardingData()` extension can proceed in parallel
- Auth gate context changes consume both, so they come last

### Risks

| Risk | Mitigation |
|------|------------|
| Enum rename breaks compilation across many files | TypeScript compiler flags every site — do a global rename, then fix each. Single atomic commit. |
| `getOnboardingData()` performance with song table join | Single-row lookup by primary key — negligible cost. The `demo_song_id` is already in the preferences row. |
| Sidebar flash on transition | `onboardingMode` is set in `beforeLoad` (server-side), not in a client effect — no flash possible. |

### Exit Criteria

- [ ] App boots, existing onboarding flow works end-to-end (all steps render on `/onboarding`)
- [ ] `ONBOARDING_STEPS` enum uses `song-walkthrough` and `match-walkthrough`
- [ ] `step-resolver.ts` exists with passing unit tests for all step → route mappings
- [ ] `getOnboardingData()` returns `walkthroughSong` when `demo_song_id` is set
- [ ] Route context exposes `onboardingMode` and `walkthroughSong`
- [ ] Sidebar visibility driven by `onboardingMode`, not path
- [ ] Layout effects suppressed when `onboardingMode !== "complete"`
- [ ] `/onboarding` route no longer auto-skips `plan-selection` for billing-disabled
- [ ] No references to `"song-showcase"` or `"match-showcase"` string literals remain

---

## Phase 2a: PlanSelectionStep Absorbs ReadyStep

> **Parallel with Phase 2b** — no file overlap

**Goal:** Merge `ReadyStep` content into `PlanSelectionStep` as an internal `success` state.
Remove the `"ready"` step from the onboarding sequence entirely.

**Why this exists:** The plan eliminates `ReadyStep` as a separate step (RD-7). This is
independent of walkthrough route work and can proceed in parallel with the navigation hook.

### Inputs / Dependencies

- Phase 1 complete (enum renamed, `ready`-based auto-skip removed)
- Current `PlanSelectionStep` with `goToStep("ready")` calls
- Current `ReadyStep` with success content and `markOnboardingComplete()` flow

### Outputs

- `PlanSelectionStep` with four internal states: `initial`, `polling`, `retry`, `success`
- `ReadyStep.tsx` and its test deleted
- `"ready"` removed from `ONBOARDING_STEPS` enum
- `STEP_CONFIG.ready` removed

### Key Touchpoints

**1. Add `success` state to `PlanSelectionStep.tsx`:**

New props (wired through `STEP_CONFIG`):
- `syncStats: { songs: number; playlists: number }`
- `readyCopyVariant: ReadyCopyVariant`

Internal state machine:

| State | Renders | Transition from |
|-------|---------|-----------------|
| `initial` | Plan cards (free / pack / unlimited) | Entry |
| `polling` | "Confirming your plan..." (animated) | After Stripe return |
| `retry` | Error recovery: `Retry confirmation` + `Choose a different plan` | Polling timeout/error |
| `success` | "You're in." + stats + tier copy + `Start Exploring →` | Free plan select, confirmed checkout, billing-disabled |

**2. Replace `goToStep("ready")` navigation:**

| Current code path | New behavior |
|-------------------|-------------|
| Free plan selected | → internal `success` state |
| `PostCheckoutView` `confirmed` | → internal `success` state |
| `PostCheckoutView` `timeout` | → internal `retry` state |
| Billing-disabled | → render `success` immediately (skip `initial`) |

**3. Remove timer-based auto-navigation:**

Current: after `confirmed`, 2s delay then `goToStep("ready")`.
New: after `confirmed`, transition to `success` state immediately. No timer.

**4. `success` state content (from ReadyStep):**

- Overline: `Complete`
- Headline: `You're in.`
- Stats: `{syncStats.songs} Songs` / `{syncStats.playlists} Playlists`
- Tier copy from `READY_COPY[readyCopyVariant]`
- CTA: `"Start Exploring →"` with Enter keyboard shortcut
- CTA handler: `markOnboardingComplete()` → optimistic cache update → navigate `/dashboard`

**5. Wire `STEP_CONFIG["plan-selection"]` in `Onboarding.tsx`:**

```tsx
"plan-selection": {
  render: (ctx) => (
    <PlanSelectionStep
      syncStats={ctx.syncStats}
      readyCopyVariant={ctx.readyCopyVariant}
    />
  ),
},
```

**6. Billing-disabled contract:**

Read `billingEnabled` from `getPlanSelectionConfig()` (add field if not present).
When `billingEnabled === false`: skip `initial`, render `success` immediately with free-tier copy.

**7. Delete:**

- `src/features/onboarding/components/ReadyStep.tsx`
- `src/features/onboarding/__tests__/ReadyStep.test.tsx`
- `STEP_CONFIG.ready` entry in `Onboarding.tsx`
- `"ready"` from `ONBOARDING_STEPS` enum in `preferences-queries.ts`
- `ready`-specific branches in `saveOnboardingStep` (phaseJobIds-clear list)
- `ready`-specific assertions in test files
- `goToStep("ready")` calls in `PlanSelectionStep`

### Parallelism Within Phase

All changes are sequential — `PlanSelectionStep` must absorb content before `ReadyStep`
can be deleted, and the enum value removal must come last.

### Risks

| Risk | Mitigation |
|------|------------|
| PlanSelectionStep state machine complexity (Stripe + internal states) | Clear state transitions documented above. Each transition has exactly one trigger. |
| `readyCopyVariant` not available when billing-disabled | `getOnboardingData()` already computes it — it falls back to `"free"` when no billing state exists. Verify. |
| Removing timer changes post-checkout UX | Intentional per RD-7 — user must click CTA to complete onboarding. No auto-advance. |

### Exit Criteria

- [ ] `PlanSelectionStep` renders `success` state with "You're in." content
- [ ] Free plan selection → `success` state (no navigation to `ready`)
- [ ] Stripe confirmed → `success` state (no timer delay)
- [ ] Billing-disabled → `success` renders immediately
- [ ] `Start Exploring →` calls `markOnboardingComplete()` and navigates to `/dashboard`
- [ ] `ReadyStep.tsx` and test deleted
- [ ] `"ready"` removed from `ONBOARDING_STEPS` enum — no compilation errors
- [ ] No string literal `"ready"` remains in codebase (except migration notes in docs)

---

## Phase 2b: Cross-Surface Navigation Hook

> **Parallel with Phase 2a** — no file overlap

**Goal:** Create `useStepNavigation()`, the hook that walkthrough route transitions use to
save step, sync cache, and navigate to the resolver-determined route.

**Why this exists:** `useOnboardingNavigation()` is scoped to `/onboarding` (uses
`useNavigate({ from: "/onboarding" })` and search-param-based step nav). Walkthrough
transitions cross routes (`/onboarding` → `/liked-songs` → `/match` → `/onboarding`),
so they need a surface-aware helper that consults the resolver. This hook is consumed by
Phases 3 and 4.

### Inputs / Dependencies

- Phase 1 complete (resolver exists, `saveOnboardingStep` works with new step names)

### Outputs

- `useStepNavigation()` hook at `src/features/onboarding/hooks/useStepNavigation.ts`
- `PickDemoSongStep` updated to use it for the `song-walkthrough` transition

### Key Touchpoints

**1. Create `src/features/onboarding/hooks/useStepNavigation.ts`:**

```ts
function useStepNavigation(): {
  navigateTo: (nextStep: OnboardingStep) => Promise<void>;
}
```

Implementation (per RD-13 + RD-14):

1. Call `saveOnboardingStep({ data: { step: nextStep } })`
2. On success, immediately sync cache:
   `queryClient.setQueryData(["auth", "onboarding"], (prev) => prev ? { ...prev, currentStep: nextStep } : prev)`
3. Optionally: `queryClient.invalidateQueries({ queryKey: ["auth", "onboarding"] })` (non-blocking)
4. Resolve target: `const resolved = resolveStep(nextStep)`
5. Navigate: if `resolved.allowedPath === "/onboarding"` → `navigate({ to: "/onboarding", search: { step: nextStep } })`;
   otherwise → `navigate({ to: resolved.allowedPath })`
6. On save failure: `toast.error("Something went wrong. Please try again.")` — stay put

**2. Update `PickDemoSongStep.tsx`:**

Replace `goToStep("song-walkthrough")` with `navigateTo("song-walkthrough")`.

The resolver maps `song-walkthrough` → `/liked-songs`, but Phase 1's auth gate still uses
the old redirect. So in Phase 2b, this navigation will:
- Save step `song-walkthrough` to DB ✓
- Navigate to `/liked-songs` ✓
- Auth gate redirects back to `/onboarding?step=song-walkthrough` ✓ (old showcase component renders)

This is correct transient behavior — Phase 3 will update the auth gate to allow `/liked-songs`.

**Alternative wiring (simpler for Phase 2b):** Keep `goToStep("song-walkthrough")` in
`PickDemoSongStep` for now. Only switch to `useStepNavigation` in Phase 3 when the auth gate
allows `/liked-songs`. This avoids the redirect-then-re-redirect during Phase 2b testing.

→ **Recommendation:** Use the alternative — wire `PickDemoSongStep` to `useStepNavigation`
in Phase 3 when the full path is functional. Phase 2b delivers the hook + tests only.

### Parallelism Within Phase

Fully sequential — hook creation then consumer update.

### Risks

| Risk | Mitigation |
|------|------------|
| Cache sync race with `ensureQueryData` staleTime | Immediate `setQueryData` updates the cache key that `beforeLoad` reads. `ensureQueryData` with non-zero staleTime will use the cache hit. Verified by RD-14. |
| `useNavigate` without `from` — type-safe routes | Use `useRouter().navigate()` or `useNavigate({ from: undefined })`. Verify TanStack Router allows navigation to absolute paths without `from`. |

### Exit Criteria

- [ ] `useStepNavigation()` exists and is tested (save → cache sync → resolve → navigate)
- [ ] Error path tested: save failure → toast, no navigation
- [ ] Hook is importable and ready for Phase 3/4 consumers

---

## Phase 3: Song Walkthrough

**Goal:** Replace `SongShowcaseStep` with the real `/liked-songs` page in walkthrough mode.
Users see their demo song in a spotlight pattern (interactive, pulsing) with real songs
greyed out below. Clicking the demo song opens the detail panel with a sticky CTA to advance.

**Why this exists:** This is the first walkthrough surface. It depends on the resolver
(Phase 1), route context (Phase 1), and `useStepNavigation` (Phase 2b) being stable.

### Inputs / Dependencies

- Phase 1 complete (resolver, route context, sidebar)
- Phase 2b complete (`useStepNavigation` hook)
- Phase 2a does NOT block this phase

### Outputs

- Auth gate uses `isPathAllowed()` — walkthrough steps route to real app pages
- `SongCard` gains `isEnabled` prop with pulse animation
- `SongDetailPanel` gains `isWalkthrough` prop with sticky CTA
- `LikedSongsPage` renders walkthrough mode when `onboardingMode === "walkthrough"`
- `SongShowcaseStep.tsx` deleted

### Key Touchpoints

**1. Activate resolver in auth gate (`_authenticated/route.tsx` `beforeLoad`):**

Replace:
```ts
if (!onboarding.isComplete && !isOnboardingRoute) {
  throw redirect({ to: "/onboarding", search: { step: onboarding.currentStep } });
}
```

With:
```ts
if (!onboarding.isComplete) {
  const resolved = resolveStep(onboarding.currentStep);
  if (!isPathAllowed(location.pathname, resolved)) {
    if (resolved.allowedPath === "/onboarding") {
      throw redirect({ to: "/onboarding", search: { step: onboarding.currentStep } });
    }
    throw redirect({ to: resolved.allowedPath });
  }
}
```

This activates walkthrough routing for both `song-walkthrough` and `match-walkthrough`.
`/match` won't have walkthrough UI until Phase 4, but users can only reach `match-walkthrough`
through the song walkthrough CTA, so this is safe during development.

**2. Add `isEnabled` prop to `SongCard` (`src/features/liked-songs/components/SongCard.tsx`):**

New optional prop: `isEnabled?: boolean` (default `true`).

When `isEnabled === false`:
- `opacity: 0.5` (replaces any existing opacity)
- `pointer-events: none`
- No hover states

When `isEnabled === true` AND in walkthrough mode — add pulse animation (RD-6):
- Prop: `isWalkthroughHighlight?: boolean` (drives pulse specifically)
- Static left border: `3px solid ${theme.primary}`
- Pulsing box-shadow: `0 0 0 → 0 0 12px ${theme.primary}40 → 0 0 0`, 2s ease-in-out, infinite
- `prefers-reduced-motion: reduce` → static left border only, no animation

```css
@keyframes walkthrough-pulse {
  0%, 100% { box-shadow: 0 0 0 transparent; }
  50% { box-shadow: 0 0 12px ${theme.primary}40; }
}
```

**3. Add `isWalkthrough` prop to `SongDetailPanel` (`src/features/liked-songs/components/SongDetailPanel.tsx`):**

New optional prop: `isWalkthrough?: boolean` (default `false`).

When `true`:
- Force `displayState` to `"unlocked"` regardless of billing (pass override to `PanelContent`)
- Pass `isWalkthrough` down to `PanelContent`

**4. Update `PanelContent` (`src/features/liked-songs/components/detail/PanelContent.tsx`):**

When `isWalkthrough === true`:
- Render: `HorizontalJourney` + `KeyLinesSection` only (skip `PlaylistsSection`)
- Analysis toggle and other analysis content renders normally
- Add sticky footer CTA at panel bottom:
  - Copy: `"See where this song belongs →"`
  - Full-width primary-theme `<button>`, pinned to bottom of panel scroll area
  - `aria-label` matches visible text
  - Click handler: `useStepNavigation().navigateTo("match-walkthrough")`
  - Loading state: `opacity-70 + pointer-events-none` on click (RD CTA pattern)

**5. Wire `LikedSongsPage` walkthrough mode (`src/features/liked-songs/LikedSongsPage.tsx`):**

Read `onboardingMode` and `walkthroughSong` from route context (passed as props from route).

Derive: `const isWalkthrough = onboardingMode === "walkthrough"`.

When `isWalkthrough`:

| Behavior | Implementation |
|----------|---------------|
| Data assembly | Build synthetic `LikedSong` from `walkthroughSong` (position 0, `displayState: "unlocked"`) + first page of real songs (de-duplicate demo song by `id`) |
| Infinite scroll | Disabled — don't call `fetchNextPage`; no scroll sentinel |
| Keyboard nav | `useListNavigation` receives `[demoSong]` only |
| Stats row | Renders normally (real totals) |
| "Unlock Songs" button | Hidden |
| Selection mode | Hidden |
| `SongCard.isEnabled` | `song.track.id === walkthroughSong.id` |
| `SongCard.isWalkthroughHighlight` | `song.track.id === walkthroughSong.id` |
| `SongDetailPanel.isWalkthrough` | `true` (only the demo song can open the panel) |

**Synthetic `LikedSong` construction:** Build a `LikedSong`-shaped object from
`WalkthroughSong` fields. Set `displayState: "unlocked"`, `liked_at: new Date()`, and
populate `track.*` from the walkthrough song fields.

**6. Update `/liked-songs` route (`src/routes/_authenticated/liked-songs.tsx`):**

Pass `onboardingMode` and `walkthroughSong` from `Route.useRouteContext()` to `LikedSongsPage`.

In the route `loader`: when `onboardingMode === "walkthrough"`, skip the
`likedSongsInfiniteQueryOptions` prefetch (walkthrough assembles its own data) or fetch
only the first page.

**7. Fail-soft guard:**

If `onboardingMode === "walkthrough"` and `walkthroughSong === null`, redirect to
`/onboarding?step=pick-demo-song`. Implement in the route `beforeLoad` or as a guard in
`LikedSongsPage`.

**8. Wire `PickDemoSongStep` to `useStepNavigation`:**

Replace `goToStep("song-walkthrough")` with `navigateTo("song-walkthrough")` from
`useStepNavigation()`. Now the resolver routes to `/liked-songs`.

**9. Delete `SongShowcaseStep.tsx`:**

- Delete `src/features/onboarding/components/SongShowcaseStep.tsx`
- Remove import from `Onboarding.tsx`
- Update `STEP_CONFIG["song-walkthrough"]` to `{ render: () => null, hideIndicator: true }`
  (this step never renders on `/onboarding` — the resolver redirects to `/liked-songs`)
- Delete any test/story files specific to `SongShowcaseStep`

**10. Initial entry behavior (RD-11):**

- Entry to `/liked-songs` for `song-walkthrough` must land with detail panel **closed**
- `useStepNavigation("song-walkthrough")` must **not** set `?song=` in the URL
- User clicks demo song → existing liked-songs mechanics open the panel + set `?song=slug`
- On refresh with `?song=<walkthroughSong.slug>` already in URL → reopen panel

### Parallelism Within Phase

Moderate:
- SongCard `isEnabled` prop (2) and SongDetailPanel `isWalkthrough` prop (3, 4) can be
  developed in parallel — they're separate components
- Auth gate activation (1) and LikedSongsPage wiring (5) depend on the component changes
- PickDemoSongStep wiring (8) and SongShowcaseStep deletion (9) come last

### Risks

| Risk | Mitigation |
|------|------------|
| LikedSongsPage is the most complex component — walkthrough branches add conditionals | Keep walkthrough logic in an early-return or mode switch at the top of the component. Don't interleave with existing code paths. |
| Synthetic `LikedSong` shape mismatch | Build a helper function that constructs the object with all required fields. Type-check against `LikedSong`. |
| Auth gate activation also allows `/match` for `match-walkthrough` — match page not ready | Users can only reach `match-walkthrough` through the song walkthrough CTA. During dev, reaching `/match` in walkthrough mode shows normal (likely empty) match UI — acceptable transient state. |
| Demo song `displayState` override might not propagate through lock checks | Trace the `displayState` → `PanelContent` → lock gate path. Force `"unlocked"` at the synthetic `LikedSong` level so all downstream checks see unlocked. |

### Exit Criteria

- [ ] `song-walkthrough` step routes user to `/liked-songs` (not `/onboarding`)
- [ ] Demo song renders at top of list, full opacity, with pulse animation
- [ ] Real songs render below, greyed out (`opacity-50`, non-interactive)
- [ ] Clicking demo song opens detail panel with analysis (no lock gate)
- [ ] `PlaylistsSection` hidden in walkthrough panel
- [ ] Sticky CTA "See where this song belongs →" visible at panel bottom
- [ ] CTA click → saves `match-walkthrough` step → navigates to `/match`
- [ ] Detail panel does NOT auto-open on entry
- [ ] `?song=` not set in URL on initial walkthrough entry
- [ ] Refresh on `/liked-songs` during `song-walkthrough` → restores walkthrough state
- [ ] Missing `walkthroughSong` → redirect to `pick-demo-song`
- [ ] `prefers-reduced-motion` → static border only, no pulse
- [ ] Sidebar hidden throughout
- [ ] `SongShowcaseStep.tsx` deleted
- [ ] Keyboard nav limited to demo song only

---

## Phase 4: Match Walkthrough

**Goal:** Replace `MatchShowcaseStep` with the real `/match` page in walkthrough mode.
Users see their demo song's match results (live or canned fallback), take one action
(Add/Dismiss/Next), and advance to plan selection.

**Why this exists:** This is the second walkthrough surface, completing the walkthrough
sequence. It depends on Phase 3's auth gate activation and established patterns.

### Inputs / Dependencies

- Phase 3 complete (auth gate uses resolver, `/liked-songs` walkthrough working)
- `useStepNavigation` from Phase 2b
- `getDemoSongMatches()` and `getDemoMatchesForSong()` already exist

### Outputs

- `/match` renders walkthrough mode when `onboardingMode === "walkthrough"`
- Non-persistent actions (Add/Dismiss/Next all advance to `plan-selection`)
- Canned data fallback after 12s timeout
- `MatchShowcaseStep.tsx` deleted

### Key Touchpoints

**1. Add walkthrough branch in `/match` route (`src/routes/_authenticated/match.tsx`):**

Read `onboardingMode` and `walkthroughSong` from route context.

When `onboardingMode === "walkthrough" && currentStep === "match-walkthrough"`:
- Do **not** use the normal `matchingSessionQueryOptions` loader path
- Render a walkthrough adapter component instead of `MatchingPageContent`

**2. Walkthrough data adapter:**

The adapter manages a three-state data pipeline:

| State | Data Source | Trigger |
|-------|------------|---------|
| Loading | None (skeleton) | Initial mount |
| Live results | `getDemoSongMatches()` poll | Poll every ~2s, demo song found in match results |
| Canned fallback | `getDemoMatchesForSong(trackId)` from `demo-matches.ts` | 12s timeout without live results |

No-playlists path: if user skipped playlist flagging, canned data renders immediately
(existing `getDemoSongMatches` returns `unavailable`, adapter falls back).

**3. Walkthrough action handlers:**

All three actions (Add, Dismiss, Next) are intercepted in walkthrough mode:

```ts
const handleWalkthroughAction = async () => {
  await navigateTo("plan-selection");
};
```

- **No** call to `addSongToPlaylist()`
- **No** call to `dismissSong()`
- **No** pagination offset increment
- All action entry points (buttons + keyboard shortcuts) route through this handler
- Invariant: when walkthrough mode, zero code paths reach real mutation RPCs

**4. Walkthrough match UI rendering:**

Reuse real components with walkthrough data:

| Component | Behavior |
|-----------|----------|
| `MatchingHeader` | `currentIndex={0}`, `totalSongs={1}` → shows "1 of 1", progress 100% |
| `SongSection` | Renders `walkthroughSong` info (name, artist, album, art — from route context, no fetch needed) |
| `MatchesSection` | Renders walkthrough matches with overridden `onAdd`, `onDismiss`, `onNext` |
| `CompletionScreen` | Never renders — first action navigates away before `isComplete` fires |

**5. Loading state (RD-12):**

During data fetch:
- Left column: demo song info from `walkthroughSong` (available immediately from context)
- Right column: skeleton placeholders (text lines + button shapes for playlist matches)
- Transition: when results arrive, matches replace skeleton

**6. Fail-soft guard:**

If `onboardingMode === "walkthrough"` and `walkthroughSong === null`, redirect to
`/onboarding?step=pick-demo-song`.

**7. Delete `MatchShowcaseStep.tsx`:**

- Delete `src/features/onboarding/components/MatchShowcaseStep.tsx`
- Remove import from `Onboarding.tsx`
- Update `STEP_CONFIG["match-walkthrough"]` to `{ render: () => null, hideIndicator: true }`
- Delete any test/story files specific to `MatchShowcaseStep`
- Check if `getDemoSongShowcase()` is now unreferenced — if so, delete it too

### Parallelism Within Phase

Limited — the data adapter, action handlers, and UI rendering are tightly coupled
within the walkthrough match page. Build bottom-up: data adapter → action handlers → UI wiring.

### Risks

| Risk | Mitigation |
|------|------------|
| Real match mutations leak through in walkthrough mode | Explicit invariant: check all action entry points (buttons, keyboard). Wrap action handlers at the component boundary where props are passed, not inside individual sub-components. |
| Canned data shape mismatch with real match UI components | `getDemoMatchesForSong()` already returns `DemoMatchPlaylist[]` — verify shape compatibility with `MatchesSection` props. May need a thin mapping layer. |
| Polling timeout race (12s) vs. user patience | 12s is the existing `MatchShowcaseStep` timeout — proven acceptable. Loading skeleton keeps the page feeling responsive. |
| `/match` route loader prefetches `matchingSessionQueryOptions` | In walkthrough mode, skip or guard this prefetch — there may not be a valid matching session. |

### Exit Criteria

- [ ] `match-walkthrough` step routes user to `/match` with walkthrough UI
- [ ] Demo song info renders immediately in left column (from route context)
- [ ] Match results appear (live poll or canned fallback after 12s)
- [ ] No-playlists path → canned data renders immediately
- [ ] Any action (Add/Dismiss/Next) → saves `plan-selection` → navigates to `/onboarding`
- [ ] No real `addSongToPlaylist` or `dismissSong` calls during walkthrough
- [ ] Keyboard shortcuts for match actions also route through walkthrough handler
- [ ] Header shows "1 of 1", progress at 100%
- [ ] CompletionScreen never renders
- [ ] Missing `walkthroughSong` → redirect to `pick-demo-song`
- [ ] Sidebar hidden throughout
- [ ] `MatchShowcaseStep.tsx` deleted
- [ ] Refresh on `/match` during `match-walkthrough` → restores walkthrough state

---

## Phase 5: Cleanup & Verification

**Goal:** Remove all remnants of the old showcase/ready architecture. Verify the complete
walkthrough onboarding flow end-to-end. Ensure test coverage for all new code paths.

**Why this exists:** Phases 1–4 each delete their immediately-relevant old components, but
cross-cutting cleanup (stale imports, orphaned helpers, test gaps) may remain. This phase
catches anything missed and validates the integrated flow.

### Inputs / Dependencies

- All previous phases complete

### Outputs

- Zero references to old showcase/ready components or step names
- Comprehensive test coverage for new walkthrough paths
- Verified end-to-end onboarding flow

### Key Touchpoints

**1. Verify deletions — no orphaned code:**

| Check | What to look for |
|-------|-----------------|
| `getDemoSongShowcase()` | If only referenced by deleted `SongShowcaseStep` → delete |
| `DemoSongData` type | If only referenced by deleted showcase components → delete |
| Showcase-specific keyboard scopes | `"onboarding-song-showcase"`, `"onboarding-match-showcase"` — remove if unused |
| Old STEP_CONFIG rendering | Verify `song-walkthrough` and `match-walkthrough` entries render `null` or are excluded |
| `StepIndicator` | Verify walkthrough steps are excluded from indicator dots (check `INDICATOR_STEPS` filter) |

**2. Test coverage audit:**

| Area | Required tests |
|------|---------------|
| `step-resolver.ts` | All step → route/mode mappings; `isPathAllowed` edge cases |
| `useStepNavigation` | Save → cache sync → navigate; save failure → toast |
| Auth gate routing | Walkthrough steps allowed on correct routes; disallowed paths redirect; complete users unrestricted |
| `PlanSelectionStep` states | `initial` → plan select → `success`; checkout → `polling` → `confirmed` → `success`; billing-disabled → `success` |
| Song walkthrough | Spotlight list assembly; demo song interactive; real songs greyed; CTA advances; fail-soft redirect |
| Match walkthrough | Data adapter (live, fallback, no-playlists); non-persistent actions; action → plan-selection |
| Sidebar visibility | Hidden in `"steps"` and `"walkthrough"` modes; visible in `"complete"` |

**3. End-to-end flow verification:**

Walk through the complete sequence manually:

```
welcome → pick-color → install-extension → syncing → flag-playlists
→ pick-demo-song → song-walkthrough (/liked-songs) → match-walkthrough (/match)
→ plan-selection (/onboarding) → complete → /dashboard
```

Verify at each transition:
- Step persists to DB (refresh resumes correctly)
- Sidebar visibility is correct
- Back-button behavior is handled (auth gate redirects to allowed path)
- Keyboard shortcuts don't leak across surfaces

**4. Edge case verification:**

| Scenario | Expected behavior |
|----------|------------------|
| Refresh during `song-walkthrough` | Restores `/liked-songs` walkthrough state |
| Refresh during `match-walkthrough` | Restores `/match` walkthrough state |
| Deep-link to `/dashboard` during walkthrough | Redirect to allowed walkthrough route |
| User with 0 liked songs in `song-walkthrough` | Only demo song shown, no greyed context |
| Demo song already in user's liked songs | De-duplicated — shown once at position 0 |
| `prefers-reduced-motion` | Pulse animation replaced with static border |

### Parallelism Within Phase

High — deletion audit, test writing, and E2E verification can proceed independently.

### Risks

| Risk | Mitigation |
|------|------------|
| Orphaned server function still imported somewhere | Global search for function name before deleting |
| Test coverage gaps discovered late | Each earlier phase has exit criteria that include basic testing. Phase 5 adds integration/E2E layer. |

### Exit Criteria

- [ ] Zero references to `"song-showcase"`, `"match-showcase"`, `"ready"` in source code
- [ ] Zero imports of deleted component files
- [ ] All new modules have unit tests
- [ ] Auth gate routing tested for all onboarding modes
- [ ] Full onboarding flow verified end-to-end (manual or integration test)
- [ ] Refresh/resume works at every walkthrough step
- [ ] No keyboard shortcut or layout effect leaks between modes
