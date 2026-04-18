# Guided Onboarding — Implementation Plan

> **Status:** In progress — interviewing decisions
>
> This plan covers reworking the `song-showcase` and `match-showcase` onboarding steps
> so they guide the user through the **real app UI** in a locked-down "guided mode,"
> rather than rendering as standalone onboarding screens.

## Framing

The current `SongShowcaseStep` and `MatchShowcaseStep` are self-contained components
rendered inside `/onboarding?step=...`. The original intent was different: these steps
should navigate the user into the actual app routes (`/liked-songs`, `/match`) in a
locked mode, teaching them how the product works with real UI — not a preview.

What doesn't exist yet: the guided shell, the surface resolver, the locked-mode
rendering in liked-songs and match pages.

## Current Repo State

- **Auth gate** (`_authenticated/route.tsx:72`): Redirects incomplete onboarding users
  away from all app routes back to `/onboarding`.
- **Sidebar** (`_authenticated/-components/Sidebar.tsx`): Always visible, `w-64` sticky.
  No hide/show mechanism.
- **Liked-songs** (`/liked-songs`): Full song list with infinite scroll, detail panel
  opens via `?song=slug` search param. Songs render as `SongCard` components.
- **Match page** (`/match`): Exists as a real app route.
- **Onboarding step** persisted to `user_preferences.onboarding_step` in DB. Loaded in
  the auth gate's `beforeLoad`.
- **Step progression**: Linear, saved to DB, redirect-on-refresh safe.

## Goals

1. After `pick-demo-song`, guide the user through the real app in locked mode
2. `song-showcase` → user sees their demo song in `/liked-songs`, clicks to open analysis
3. `match-showcase` → user sees match results in `/match`
4. Sidebar hidden during guided mode, appears after plan selection
5. Onboarding step still tracked in DB for refresh/resume safety
6. Plan selection happens on `/onboarding` after guided steps (see RD-5, RD-7)

## Product Rules

- The guided steps use the real app UI — not separate showcase components
- Onboarding is not "complete" until the user picks their plan
- The user cannot access the full app until onboarding completes

---

## Resolved Decisions

### RD-1: Routing strategy — how guided mode users reach app routes

**Decision:** Option A — the persisted onboarding step is the source of truth.

**But not as an ad-hoc whitelist.** A centralized **onboarding surface resolver** maps
`onboardingStep → { allowedRoute, shellMode }`. The auth gate and layout both consult
this single resolver.

This keeps refresh/resume correct and prevents onboarding logic from scattering across
the auth gate, layout, and individual page components.

**Step-to-route mapping:**

| Onboarding Step   | Allowed Route  | Shell Mode                                                |
| ----------------- | -------------- | --------------------------------------------------------- |
| `song-showcase`   | `/liked-songs` | Sidebar hidden, demo song interactive + real songs dimmed |
| `match-showcase`  | `/match`       | Sidebar hidden, guided match view                         |
| `plan-selection`  | `/onboarding`  | Standard onboarding shell                                 |
| All earlier steps | `/onboarding`  | Standard onboarding shell (current behavior)              |

---

## Resolved Decisions (continued)

### RD-2: Song showcase — advancing to match-showcase

**Decision:** `SongDetailPanel` gains a `mode: "normal" | "guided-showcase"` prop.
In `guided-showcase` mode, the panel renders analysis only and exposes a sticky
footer CTA that advances the user to `match-showcase`.

**Panel content in `guided-showcase`:**

- Render `Hero + HorizontalJourney + KeyLinesSection` only
- Do **not** render `PlaylistsSection` (that teaching moment belongs to the
  `/match` step)
- Force unlocked — the demo song bypasses entitlement, and guided mode must not
  gate the analysis behind the normal lock UI

**Sticky footer CTA:**

- Final copy: `"See where this song belongs →"`
- Full-width primary-theme native `<button>` pinned to the panel bottom
- `aria-label` matches visible text; Enter/Space activate via the native button
- Respects `prefers-reduced-motion` for any mount animation

**CTA click handler:** Uses the surface-aware onboarding navigation helper from
RD-13:

1. `saveOnboardingStep({ step: "match-showcase" })`
2. `navigate({ to: "/match" })`

**Mode wiring:** `LikedSongsPage` reads `shellMode` and the current onboarding
step from route context and passes `mode="guided-showcase"` to `SongDetailPanel`
only when `shellMode === "guided-no-sidebar"` and the step is `song-showcase`.
Normal (`mode: "normal"`) behavior is unchanged.

**Why hide `PlaylistsSection`:** Leaving it live would let the user write real
`match_decision` rows before onboarding completes — directly contradicting the
non-persistent invariant from RD-3 — and would duplicate the `/match` step's
teaching moment. Leaving it visible-but-disabled looks broken. Hiding it
preserves a single clear next action (the sticky CTA) and saves the playlist
decision lesson for `match-showcase`.

The user is already reading the analysis — the next action lives right there.

### RD-3: Match showcase — real /match page with guided data adapter

**Decision:** The match showcase uses the **real `/match` page** in guided mode — same
principle as `/liked-songs` (real page, guided behavior), but with a different data
strategy.

**Why different:** `/liked-songs` can simply filter the existing song list to the demo
song. `/match` is driven by a session snapshot + offset pagination flow, and there is
no guarantee the demo song appears first (or at all) in the normal session. The guided
mode needs a data adapter that preferentially presents the demo song.

**Guided data adapter for `/match`:**

1. If the normal match session already has results for the demo song → use them,
   rendered through the real matching UI components
2. If not ready → poll briefly (reuse existing ~2s polling interval)
3. If still not ready after ~12s → fall back to canned demo data from `demo-matches.ts`,
   rendered through the same UI components
4. After the first user action (add / dismiss / next) → advance to `plan-selection`
   on `/onboarding` instead of continuing normal pagination

**Guided action contract:** In guided mode, `/match` reuses the real visual matching UI,
but **none of the guided actions persist real match decisions**. This is true whether the
page is rendering live demo-song results from the snapshot or canned fallback data from
`demo-matches.ts`.

- Guided `Add` does **not** call
  `addSongToPlaylist({ data: { songId: string; playlistId: string } })`
- Guided `Dismiss` does **not** call
  `dismissSong({ data: { songId: string; playlistIds: string[] } })`
- Guided `Next` does **not** continue normal pagination
- All three actions instead call the shared surface-aware onboarding transition helper to:
  1. `saveOnboardingStep({ step: "plan-selection" })`
  2. navigate to `/onboarding?step=plan-selection`
- All guided action entry points (buttons, keyboard shortcuts, and any other action
  triggers wired by the matching surface) must route through this same handler
- Invariant: when `shellMode === "guided-no-sidebar" && currentStep === "match-showcase"`,
  no code path may call `addSongToPlaylist` or `dismissSong`

**Why this is required:** canned demo matches use synthetic playlist IDs from
`demo-matches.ts`, while the real match decision RPCs validate UUID playlist IDs. A
single non-persistent guided action contract avoids split behavior between live and
fallback states and avoids mutating user playlist decisions before onboarding is complete.

**UI behavior:** Keep the existing `Add`, `Dismiss`, and `Next Song` labels/placement so
the user learns the real interaction model. On click, act immediately — no extra toast,
confirmation, or intermediate success state. The route transition itself is the feedback.

**Page chrome:** Header renders normally (shows "1 of 1", progress bar at 100%).
`CompletionScreen` never triggers — first action advances before pagination completes.

**The demo song bypasses entitlement.** The existing `getDemoSongMatches()` reads directly
from `match_result` rows filtered by song ID — not through the entitled selector.
Entitlement (free allocation of 15 songs) is only granted at `markOnboardingComplete()`,
which happens after plan selection.

**No-playlists path:** If the user skipped playlist flagging (no targets), no real
matching is possible. The guided adapter returns canned demo data immediately.

**Fail-soft invariant for missing demo song:** If guided `match-showcase` loads
without a valid `guidedDemoSong` in route context, do not render a broken guided
match screen and do not fall back to an unrelated default track. Redirect to
`/onboarding?step=pick-demo-song` so the user can reselect the prerequisite song.

**Scope:** This rule covers recoverable invariant breaks (resume/deep-link/stale
selection shape mismatch). Exceptional crashes (thrown loader/server failures)
continue using the existing global root error boundary.

**Principle:** Same guided-route pattern as `/liked-songs`; different data strategy.

### RD-4: Song showcase — header and page copy

**Decision:** Show the real liked-songs header as-is. No onboarding-specific copy.
Reinforces "you're in the real app." Stats row shows whatever the real data says.

### RD-5: Plan selection — where it lives

**Decision:** Back to `/onboarding?step=plan-selection`. Plan selection is a
billing/commitment moment, not app teaching. After the match showcase on `/match`,
navigate back to the onboarding shell for plan selection.

`PlanSelectionStep` remains the final onboarding gate for both billing-enabled and
billing-disabled environments (provider-disabled behavior is specified in RD-7).

This also means the surface resolver mapping becomes:

| Onboarding Step   | Allowed Route  | Shell Mode                                                |
| ----------------- | -------------- | --------------------------------------------------------- |
| `song-showcase`   | `/liked-songs` | Sidebar hidden, demo song interactive + real songs dimmed |
| `match-showcase`  | `/match`       | Sidebar hidden, guided match view                         |
| `plan-selection`  | `/onboarding`  | Standard onboarding shell                                 |
| All earlier steps | `/onboarding`  | Standard onboarding shell                                 |

### RD-6: Visual cue for clickable demo song

**Decision:** Subtle pulse/glow on the demo song card to draw attention.

**Animation:**

- Static left border: `3px solid ${theme.primary}` (reuses existing highlight pattern)
- Pulsing box-shadow: `0 0 0 → 0 0 12px ${theme.primary}40 → 0 0 0`
- Timing: 2s duration, ease-in-out, infinite loop
- Stops when: user clicks the card (card transitions to selected/expanded state)

**Reduced motion:**

When `prefers-reduced-motion: reduce`, skip the animation. Show static left border
only — the border alone is sufficient cue against the greyed siblings.

**Implementation:**

```css
@keyframes guided-pulse {
  0%, 100% { box-shadow: 0 0 0 transparent; }
  50% { box-shadow: 0 0 12px ${theme.primary}40; }
}
```

`SongCard` applies this animation when `isInteractive && mode === "guided-showcase"`.

### RD-7: Transition out of guided mode — drop ReadyStep

**Decision:** Drop `ReadyStep` as a separate step. `PlanSelectionStep` absorbs its
content into an internal success state. The `ready` enum value is removed entirely.

**`PlanSelectionStep` internal states:**

| State   | Renders                                                                     |
| ------- | --------------------------------------------------------------------------- |
| initial | Plan cards (free / pack / unlimited)                                        |
| polling | "Confirming your plan..." (after Stripe return, awaiting webhook)           |
| retry   | Timeout/error recovery UI (`Retry confirmation`, `Choose a different plan`) |
| success | "You're in" + sync stats + tier copy + `Start Exploring` CTA                |

**Checkout confirmation gate (required):**

- `Start Exploring` is **not** shown for paid checkout flows until billing confirmation succeeds
- Paid flow state mapping:
  - `polling` → no `Start Exploring`
  - `confirmed` → enter `success` (show `Start Exploring`)
  - `timeout/error` → enter `retry` (do not show `Start Exploring`)
- Free path and provider-disabled path are exempt: they can enter `success` directly
- Remove timer-based auto-navigation from post-checkout polling outcomes;
  onboarding completion remains user-triggered via the `Start Exploring` CTA

**Billing-disabled contract (`env.BILLING_ENABLED === false`):**

- `plan-selection` is still rendered on `/onboarding` (no route-level auto-skip)
- `PlanSelectionStep` does not render plan cards or checkout polling
- It renders the same `success` state immediately (free-tier copy + stats +
  `Start Exploring →` CTA)
- CTA behavior is unchanged: `markOnboardingComplete()` then navigate to `/dashboard`

**Timeout/error behavior for paid checkout:**

- `retry` state shows two actions:
  1. `Retry confirmation` (restart polling for the same checkout intent)
  2. `Choose a different plan` (clear pending intent and return to `initial`)
- `retry` state never calls `markOnboardingComplete()` directly

**Plan config API update (exact contract):**

```ts
interface PlanSelectionConfig {
  billingEnabled: boolean;
  quarterlyPlanEnabled: boolean;
}

getPlanSelectionConfig(): Promise<PlanSelectionConfig>
```

`billingEnabled` is sourced from `env.BILLING_ENABLED` and drives the provider-
disabled branch above.

**Success state content (absorbed from `ReadyStep`):**

- Overline: `Complete`
- Headline: `You're in.`
- Stats row: `{syncStats.songs} Songs` / `{syncStats.playlists} Playlists`
- Tier copy (from `READY_COPY`):
  - free: `"Exploring your 15 songs. An email's on its way when it's ready."`
  - pack: `"Exploring your selected songs. An email's on its way when it's ready."`
  - unlimited: `"Going through every song. An email's on its way when it's ready."`
- CTA: `"Start Exploring →"` (Enter key shortcut)

**Success state behavior:**

- Click CTA → `markOnboardingComplete()` → navigate to `/dashboard`
- Sidebar appears naturally because `isComplete` is now true

**Step sequence becomes:**

```
welcome → pick-color → install-extension → syncing → flag-playlists
→ pick-demo-song → song-showcase → match-showcase → plan-selection → complete
```

**Route-guard cleanup required in `/onboarding` beforeLoad:**

- Remove `ready`-based billing auto-skip logic:
  - remove `isAutoSkipPlanSelection` (`search.step === "ready" ... !env.BILLING_ENABLED`)
  - remove redirect `if (search.step === "plan-selection" && !env.BILLING_ENABLED) -> step: "ready"`
- Keep `plan-selection` reachable regardless of `BILLING_ENABLED`

**Data flow for success state:**

- `PlanSelectionStep` gains a `syncStats` prop (same shape as `ReadyStep` had)
- `STEP_CONFIG["plan-selection"]` passes `ctx.syncStats` to the component
- Tier copy uses server-derived `readyCopyVariant` from `OnboardingData` as the
  canonical source of truth (refresh/resume safe)
- `STEP_CONFIG["plan-selection"]` passes `ctx.readyCopyVariant` to
  `PlanSelectionStep` for success-state rendering
- Local selected-plan state may still drive immediate in-session transitions, but it
  must not be the sole source for success copy

**Delete:**

- `src/features/onboarding/components/ReadyStep.tsx`
- `src/features/onboarding/__tests__/ReadyStep.test.tsx`
- `STEP_CONFIG.ready` entry in `Onboarding.tsx`
- `"ready"` from `ONBOARDING_STEPS` enum in `preferences-queries.ts`
- Remaining `data.step === "ready"` checks (for example in
  `saveOnboardingStep` cleanup branches)
- Legacy `goToStep("ready")` navigation paths in `PlanSelectionStep` (replace with
  internal state transitions + final `markOnboardingComplete()` CTA)
- `ready`-specific assertions in `onboarding-flow.test.tsx`

**Keep:**

- `readyCopyVariant` in onboarding step context as a pass-through for
  `PlanSelectionStep` success copy
- `ReadyCopyVariant` type export in `onboarding.functions.ts` (still used by
  `PlanSelectionStep`)

**Pre-prod cleanup (optional):**

```sql
UPDATE user_preferences SET onboarding_step = 'complete'
WHERE onboarding_step = 'ready';
```

Not required — test accounts that restart onboarding are acceptable.

### RD-9: Surface resolver — shape, location, and integration

**Decision:** Pure module at `src/features/onboarding/surface-resolver.ts`.

**API:**

```ts
type ShellMode = "normal" | "onboarding" | "guided-no-sidebar";

type AllowedPath = "/onboarding" | "/liked-songs" | "/match";

type SurfaceConfig = {
  allowedPath: AllowedPath;
  shellMode: "onboarding" | "guided-no-sidebar"; // subset — resolver only handles incomplete
};

function resolveOnboardingSurface(step: OnboardingStep): SurfaceConfig;
function isPathAllowedForSurface(pathname: string, surface: SurfaceConfig): boolean;
```

**Mapping (incomplete onboarding only):**

| Step             | `allowedPath`  | `shellMode`         |
| ---------------- | -------------- | ------------------- |
| `song-showcase`  | `/liked-songs` | `guided-no-sidebar` |
| `match-showcase` | `/match`       | `guided-no-sidebar` |
| All others       | `/onboarding`  | `onboarding`        |

**Auth gate behavior in `_authenticated/route.tsx` `beforeLoad`:**

```
If onboarding.isComplete === true:
  - Do NOT call resolver or enforce route restrictions
  - Set route context shellMode: "normal"
  - Sidebar visible (normal app behavior)

If onboarding.isComplete === false:
  - Resolve surface with resolveOnboardingSurface(currentStep)
  - Enforce route restriction via isPathAllowedForSurface(pathname, surface)
  - Set route context shellMode from resolver ("onboarding" | "guided-no-sidebar")
  - Sidebar hidden (both onboarding shell modes hide it)
```

**Layout sidebar logic:**

```tsx
{shellMode === "normal" && <Sidebar ... />}
```

**Layout side-effect gating (same rule):**

- Replace pathname-based onboarding heuristics (e.g. `location.pathname.startsWith("/onboarding")`) for layout-level effects.
- Normal app-only effects run **only** when `shellMode === "normal"`.
- In `shellMode: "onboarding" | "guided-no-sidebar"`, suppress normal app effects (for example `useActiveJobCompletionEffects`) so guided `/liked-songs` and `/match` remain tutorial-only surfaces.

**Navigation contract:** `useOnboardingNavigation()` remains `/onboarding`-scoped.
Guided route transitions (e.g., `/liked-songs` → `/match`) must use
`useSurfaceAwareOnboardingNavigation()` from RD-13.

### RD-16: Demo song rendering in guided /liked-songs — spotlight pattern

**Decision:** In guided `song-showcase` mode, show the demo song at the top of the
list with the user's real liked songs visible but greyed out below. This follows
the established "spotlight with dimmed context" onboarding pattern.

**Data assembly in guided mode:**

1. Fetch first page of user's real liked songs (standard query, ~20-30 songs, no
   infinite scroll continuation)
2. Build synthetic `LikedSong` for the demo song from demo-song infrastructure
3. Remove any real song with the same `song.id` as the demo song (de-duplication)
4. Prepend demo song to the list (always position 0)
5. Mark each song with `isInteractive` flag: `true` for demo, `false` for real songs

**Not:** mutate the user's real library by inserting a `liked_song` row for the demo.
**Not:** hide the user's real songs entirely (loses context).

**Why spotlight pattern:**

Industry-standard approach (Atlassian, Adobe, etc.) for guided onboarding:
- Single interactive element reduces cognitive load
- Dimmed context shows "this is your real library" without overwhelming
- User doesn't have to guess where to click — the UI directs them
- Pulse cue on demo song (RD-6) draws attention against greyed siblings

**SongCard changes:**

New `isInteractive` prop (default `true`). When `false`:
- Visual treatment: `opacity-50` + `pointer-events-none` + no hover states
- No grayscale filter in baseline implementation (keep typography and album art
  legible while clearly non-interactive via opacity + pointer lock)

**Product truth preserved:** User sees their real library exists (validates sync
worked) while understanding "we're focusing on this one song for the tutorial."

**Fail-soft invariant for missing demo song:** If guided `song-showcase` loads
without a valid `guidedDemoSong` in route context, do not render a broken spotlight
state and do not substitute an arbitrary real song. Redirect to
`/onboarding?step=pick-demo-song` so the user can reselect the prerequisite song.

**Edge cases:**

- User has 0 liked songs → only demo song shown, no greyed context (graceful fallback)
- User has < 20 songs → show all real songs greyed, demo at top
- Demo song already appears in fetched liked songs → show it once (interactive, top)
- Demo song not in user's library → expected; demo is synthetic, not from their Spotify

### RD-17: Guided /liked-songs page chrome — constrained interaction

**Decision:** In guided `song-showcase` mode, page chrome adapts to support the
spotlight pattern while keeping the "real app" feel.

**What stays visible:**

- Header title ("Your Music" / "Liked Songs")
- Stats row (shows real library totals — now makes sense with greyed songs visible)

**What's hidden:**

- "Unlock Songs" button (action not available during onboarding)
- Selection mode entry (pack user song selection)

**What's disabled:**

- Infinite scroll load-more (`fetchNextPage` not called; first page only)
- Keyboard navigation to greyed songs (navigation list filtered to interactive songs)

**Keyboard behavior:**

`useListNavigation` receives `songs.filter(s => s.isInteractive)` — only the demo
song is in the navigation list. Arrow keys / j/k have nowhere to go (single item).
Enter/Space on focused demo song opens detail panel normally.

**Implementation:**

`LikedSongsPage` reads `shellMode` and `currentStep` from route context and derives
`mode="guided-showcase"` only when
`shellMode === "guided-no-sidebar" && currentStep === "song-showcase"`.
When derived mode is `guided-showcase`:

```
┌─────────────────────────────────────────────────────────────────┐
│ Data: demoSong (interactive) + realSongs.slice(0, ~20) (greyed) │
│ Stats query: runs normally, displays real totals                │
│ Unlock button: hidden                                           │
│ Infinite scroll: disabled                                       │
│ Keyboard nav list: [demoSong] only                              │
│ SongCard.isInteractive: derived from song.id === demoSong.id    │
└─────────────────────────────────────────────────────────────────┘
```

**Visual hierarchy in guided mode:**

1. Demo song card: full opacity, RD-6 pulse cue, hover states active, clickable
2. Real song cards: `opacity-50`, no hover, `pointer-events-none`
3. Stats row: normal rendering (totals now contextualize the greyed songs)
4. Header: unchanged

### RD-15: Cleanup of old showcase components

**Decision:** Delete the standalone showcase components. Keep the underlying server/
data helpers that the guided routes still consume.

**Delete:**
- `src/features/onboarding/components/SongShowcaseStep.tsx`
- `src/features/onboarding/components/MatchShowcaseStep.tsx`
- `STEP_CONFIG` entries for `song-showcase` and `match-showcase` in `Onboarding.tsx`
  (those steps no longer render inside the onboarding shell)
- Tests/stories/keyboard shortcut scopes tied only to these components
- `getDemoSongShowcase()` and `DemoSongData` if they are only referenced by removed
  showcase components

**Keep (still used by guided adapters):**
- `getDemoSongMatches()` — guided `/match` uses it for poll-until-ready + canned fallback
- `getDemoMatchesForSong()` — static canned data lookup, used as timeout fallback
- `demo-matches.ts` data module

**Why no fallback UI:**
Keeping the old components as fallback would:
- Preserve the old mental model (step = standalone screen) we're explicitly removing
- Create two onboarding experiences to maintain, which will drift
- Hide real integration problems by silently falling back to old screens
- Muddy the architecture when we're trying to simplify it

One real path, clear tests, no shadow fallback UI.

**Cut line:** Remove old standalone presentation; keep reusable data-fetching/fallback
logic.

### RD-14: Refresh/resume safety — no atomic transactions

**Decision:** No atomic transaction between `saveOnboardingStep()` and client
navigation. A real shared transaction boundary is not available anyway
(server-side DB write + client-side route change are different systems).

**Invariant for guided transitions:**

1. Attempt `saveOnboardingStep(nextStep)`
2. On success, immediately update onboarding cache key
   `ONBOARDING_QUERY_KEY = ["auth", "onboarding"]` so `currentStep` matches `nextStep`
3. Only navigate after save + cache update succeed
4. If save fails, show error toast and stay put
5. On refresh, `_authenticated/route.tsx` + surface resolver reconstruct the correct
   surface from persisted step

**Failure model:**

| Case                                 | Outcome                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| Save succeeds, navigate succeeds     | Normal flow                                                    |
| Save succeeds, navigate fails (rare) | On next load, surface resolver routes user to the correct step |
| Save fails                           | Stay on current step, show error, user retries                 |

**What we avoid:** Pending-transition state, compensating actions, retry queues,
optimistic client routing that can desync from DB. Worst-case failure is repeating
one guided interaction — acceptable for onboarding.

**What we ensure:** Guided actions must be idempotent. Repeating `song-showcase` or
`match-showcase` must not corrupt state. Side effects (if any) should be coherent on
re-render.

**Why the cache write is required:** `_authenticated/route.tsx` reads
`["auth", "onboarding"]` via `ensureQueryData` with a non-zero stale time on same-session
navigations. Without immediate cache sync, cross-surface transitions can route using a
stale `currentStep`.

### RD-13: Surface-aware onboarding navigation helper

**Decision:** Don't use `useOnboardingNavigation()` for guided transitions — it's
`/onboarding`-centric (`useNavigate({ from: "/onboarding" })` + search-param-based step
navigation), which is the wrong abstraction for cross-surface moves like
`/onboarding → /liked-songs → /match → /onboarding`.

**Create a shared surface-aware navigation helper** (e.g., `useSurfaceAwareOnboardingNavigation()`).
It:

1. Calls `saveOnboardingStep({ step: nextStep })` (existing server function)
2. Immediately syncs onboarding cache:
   `queryClient.setQueryData<OnboardingData>(["auth", "onboarding"], (prev) => prev ? { ...prev, currentStep: nextStep } : prev)`
3. Optionally triggers non-blocking background revalidation:
   `queryClient.invalidateQueries({ queryKey: ["auth", "onboarding"] })`
4. Consults the surface resolver (`resolveOnboardingSurface(nextStep)`)
5. Navigates to either `/onboarding?step=...` or the guided route for that step

This keeps DB state as the single source of truth for refresh/recovery and generalizes
the navigation pattern around the surface resolver rather than the old `/onboarding`
search-param hook.

**Used by:**
- `PickDemoSongStep` CTA (`pick-demo-song` → `song-showcase`)
- `SongDetailPanel` guided CTA (`song-showcase` → `match-showcase`)
- `/match` guided action handler (`match-showcase` → `plan-selection`)
- Any future step transition that might cross surfaces

**Not used by:** Existing `/onboarding` steps — they can continue using
`useOnboardingNavigation()`. (Or we can migrate them later — not required for this plan.)

### RD-12: Match page loading state in guided mode

**Decision:** Show the real two-column match layout during loading:

- **Left (song section):** Demo song album art, title, artist — already available from
  the previous step, no extra fetch needed.
- **Right (matches section):** Skeleton placeholders for playlist matches (just text
  lines + button shapes — playlist name, score, add button). Simple since matches are
  lightweight UI (text + button per row).

When results arrive (or 12s timeout fires with canned data), matches animate in
replacing the skeleton. Maintains the "real app" feel throughout.

### RD-11: Detail panel behavior in song showcase

**Decision:** Two points:

1. **No auto-open.** The user must click the demo song to open the detail panel.
   The pulse cue is enough. Auto-opening would skip the "click a song to see analysis"
   lesson, which is the whole point of this guided step.

2. **Navigate immediately on CTA click.** When the user clicks the advance CTA at the
   bottom of the detail panel, navigate to `/match` immediately. No close animation
   first — the route change unmounts the page anyway.

### RD-10: Demo song identity in route context

**Decision:** Extend `getOnboardingData()` to include a small typed object for the
selected demo song. Expose it through `_authenticated/route.tsx` route context alongside
the resolved onboarding surface.

**Shape:**

```ts
guidedDemoSong: {
  id: string;
  spotifyTrackId: string;
  slug: string;
  name: string;
  artist: string;
  album: string | null;
  albumArtUrl: string | null;
} | null
```

**Field mapping from `song` table:**

| Field            | Source                                |
| ---------------- | ------------------------------------- |
| `id`             | `song.id`                             |
| `spotifyTrackId` | `song.spotify_id`                     |
| `slug`           | generated via `generateSongSlug()`    |
| `name`           | `song.name`                           |
| `artist`         | `song.artists[0] ?? "Unknown Artist"` |
| `album`          | `song.album_name`                     |
| `albumArtUrl`    | `song.image_url`                      |

**Why this shape:**

- `/liked-songs` needs `id` + `slug` for filtering and detail-panel open state
- `/match` loading state needs `name`, `artist`, `album`, `albumArtUrl` to render the
  song section immediately (RD-12) without an extra fetch
- Single route-context source of truth — no navigation-state fragility

**What already exists vs. what's new:**

- `demo_song_id` is persisted on `user_preferences` ✓
- `saveDemoSongSelection()` writes it ✓
- `getDemoSongShowcase()` reads it ✓
- `getOnboardingData()` does **not** currently include it — needs extension
- `_authenticated/route.tsx` route context does **not** expose it — needs extension

**Integration:**

1. `getOnboardingData()` reads `demo_song_id` from preferences, fetches the song row
   from the `song` table, maps fields per the table above, returns `guidedDemoSong`
   (or `null` if no demo song selected)
2. `_authenticated/route.tsx` includes `guidedDemoSong` in route context
3. Guided `/liked-songs` reads it from route context to filter the list and support
   detail-panel open state
4. Guided `/match` reads it from route context to render the song section immediately
   during loading (no extra fetch needed)

**Initial-entry vs. resumed-open behavior:**

- Initial guided entry to `/liked-songs` for `song-showcase` must land with the demo
  song visible and the detail panel **closed**
- The entry transition into `song-showcase` must **not** set `?song=` in the URL
- The user opens the panel by clicking the demo song card, using the existing
  liked-songs page mechanics
- After that click, the existing liked-songs URL sync may set
  `?song=<guidedDemoSong.slug>` as normal
- If the user refreshes or resumes while still on `song-showcase` and the URL already
  includes `?song=<guidedDemoSong.slug>`, guided `/liked-songs` should reopen the panel

**Role of `guidedDemoSong.slug`:** it exists for compatibility with the existing
liked-songs panel-open contract and refresh/resume continuity after the user has
opened the panel. It is **not** used to force the panel open on first entry.

### RD-8: Transition out of guided mode — no special animation

**Decision:** No special animation. `PlanSelectionStep` calls `markOnboardingComplete()`
and navigates to `/dashboard`. The sidebar simply appears because the auth gate sets
`shellMode: "normal"` for completed users (see RD-9). The entire page is changing
anyway (route transition), so animating the sidebar separately would feel odd.
