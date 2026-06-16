# Onboarding restructure — fake-demo-first

Working plan. Each phase is self-contained: read **Shared context** + the phase you're
executing and you have everything you need. Do **not** read the whole file to do one phase.

> **Hard rule for every phase: do NOT add, edit, or rewrite user-facing copy.**
> Copy is a separate, later, interactive pass. Keep existing strings verbatim; if a new
> element structurally needs a string, leave a `TODO(copy)` placeholder and move on.

## Status

- [x] **Phase 1 — Reorder steps + handle migration + guard tests** ✅ done 2026-06-16
- [x] **Phase 2 — Preview-routing skeleton (`flag-playlists` → real `/playlists`)** ✅ done 2026-06-16
- [x] **Phase 3 — Sandbox data in `/playlists` preview (canned playlists + local actions)** ✅ done 2026-06-16
- [x] **Phase 4 — Salvage the intent shuffle into the real writing surface** ✅ done 2026-06-16
- [ ] Phase 5 — Fully-fake match reveal + `/liked-songs` sandbox · _audited 2026-06-16_
- [ ] Phase 6 — Retire bespoke flag components · _audited, delete-list incomplete_
- [ ] Phase 7 — Copy pass (deferred; interactive, not for an agent)

> **Audit note (2026-06-16):** Phases 2–6 were verified against the real code (read-only)
> the same way Phase 1 was, before executing them. Each phase below now carries a dated
> **"⚠ Audit corrections"** block with CONFIRMED / WRONG / GAP findings and the decisions
> they surface. Read the corrections block *first* — the original prose under it is the
> pre-audit intent and is wrong in places (esp. Phase 4).

---

## Shared context

### The goal

A first-time user must learn *how hearted works* before being asked to do real,
high-cognitive-load work. So the **demo moves to the front** and runs on **entirely
canned data** (no Spotify, no extension, no sync). Only after the user "gets it" do we
ask them to connect their real library and personalize.

The product premise (the spine): *you have liked songs, you have playlists; tell us what
each playlist is for and your songs find their way in.*

### Step order

Same 11 steps as before — **reordered only, nothing added or removed** (keeps the
migration minimal). Source of truth: `src/lib/domains/library/accounts/onboarding-steps.ts`.

| # | Step | Phase in the UX |
|---|---|---|
| 1 | `welcome` | hook |
| 2 | `flag-playlists` | demo — canned `/playlists` preview |
| 3 | `pick-demo-song` | demo — already canned |
| 4 | `song-walkthrough` | demo — canned `/liked-songs` preview |
| 5 | `match-walkthrough` | demo — canned matches |
| 6 | `install-extension` | connect for real |
| 7 | `syncing` | connect for real |
| 8 | `pick-color` | personalize |
| 9 | `claim-handle` | personalize |
| 10 | `plan-selection` | — |
| 11 | `complete` | — |

Old order, for reference: welcome → pick-color → install-extension → syncing →
claim-handle → flag-playlists → pick-demo-song → song-walkthrough → match-walkthrough →
plan-selection → complete.

### Why `claim-handle` is "bolted down"

Claiming a handle must be race-safe and unique, so it lives in a Postgres function
(latest: `supabase/migrations/20260616140000_recreate_claim_handle_rpc_reorder.sql`),
**not** app code. SQL can't import the TS step list, so the function **hand-copies** two
order-dependent facts:
1. A "who is allowed to claim a handle yet" gate: `v_existing_step NOT IN (...)` — the
   list of steps from `claim-handle` onward. **Now `('claim-handle', 'plan-selection',
   'complete')`** (post-reorder, claim-handle is step 9).
2. After a successful claim it advances the user to the **next** step. **Now
   `onboarding_step = 'plan-selection'`** (two `UPDATE`s in the function), was
   `'flag-playlists'`.

The tripwire test (`onboarding-steps.test.ts`) re-parses the gate list from the **latest**
migration that defines `claim_handle` and fails if it drifts from the TS tuple.

> **Correction to the original claim "the post-claim advance has no test":** it *does* —
> `claim-handle.integration.test.ts` (live-DB, cases 1 & 7) asserts the advance target. It's
> gated behind a local `DATABASE_URL` (`describe.skip` otherwise), so it doesn't run in
> plain `bun run test`/CI — which is why it reads as "untested." Run it with
> `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" bun run test <file>`.
> The advance also has a TS mirror: `account-handle.functions.ts` calls the RPC and reads the
> result back (it does not advance independently), and `DevWorkflowPanel.reachPlanSelection`
> re-asserts `plan-selection` after a dev claim.

### The canned demo data already exists

`src/lib/content/landing/demo-matches.ts`:
- `DEMO_PLAYLISTS` — 7 playlists, each `{ id, name, reason }` (ids `"1"`–`"7"`). Currently
  **not exported**.
- `DEMO_SONG_MATCHES` — ~20 songs (by Spotify track id) → 3 matching playlist ids + scores.
- `getDemoMatchesForSong(spotifyTrackId)` — exported; returns canned matches (falls back to
  a default track).

Demo songs for the picker come from `src/lib/content/landing/landing-songs` (the same
curated set) — `PickDemoSongStep` already uses these, so the song step is **already fake**.

### The "preview prod" pattern (already used by `song-walkthrough`)

An onboarding step can render `null` in the orchestrator and instead route the user to a
**real** app route, which detects the onboarding session and renders stripped-down chrome.
Today `song-walkthrough → /liked-songs` and `match-walkthrough → /match` work this way. We
mirror it for `flag-playlists → /playlists`.

Key files for the pattern:
- `src/features/onboarding/step-resolver.ts` — `AllowedPath`, `resolveSession` (step→path),
  `isPathAllowed` (currently **strict equality**).
- `src/lib/domains/library/accounts/onboarding-session.ts` — `OnboardingMode` union +
  `sessionMode()`.
- `src/routes/_authenticated/route.tsx` — `beforeLoad` enforces `isPathAllowed`; computes
  `showShell` / `showSidebar` from the mode.
- `src/features/onboarding/Onboarding.tsx` — `STEP_CONFIG` per step.

### The intent "shuffle" to salvage

`src/features/onboarding/components/DescriptionExamplesShuffle.tsx` — cycles 12 ready-made
descriptions (+ genres) and emits the chosen one via `onPick(description, genres)`. It's
self-contained (only importer today: `OnboardingDescriptionDialog.tsx`). We graft it onto
the real writing surface so users can *pick* an intent instead of writing one. Bonus: this
then helps all users, not just onboarding.

> **⚠ Corrected target (audit 2026-06-16):** the original plan named
> `PlaylistWritingSurface.tsx` as "the real writing surface." It is **not** — its only
> production caller is `OnboardingDescriptionDialog.tsx` (which Phase 6 deletes), so it's
> effectively dead. The surface users actually see in the `/playlists` detail panel is
> `src/features/playlists/components/explorations/WritingSurface.tsx`, rendered by
> `explorations/SpotlightPanel.tsx`, rendered by the **production** `PlaylistsCoverFlowScreen`
> (the `explorations/` folder name is misleading — it *is* the shipped `/playlists` screen).
> Phase 4 must graft onto `SpotlightPanel` + `explorations/WritingSurface`. See Phase 4.

### Project rules (apply to every phase)

- Use **bun**, never npm. Tests: `bun run test` (Vitest).
- No barrel exports. Read files before editing. Absolute paths.
- Comments explain WHY only.
- Never skip/disable tests — fix root cause.
- Work on `main`.

### Open decisions (resolve in the phase that hits them; don't guess silently)

- **D1 — picked playlists vs. canned matches (Phase 5).** `DEMO_SONG_MATCHES` maps each
  song to fixed playlist ids `"1"`–`"7"`. After Phase 3, the `flag-playlists` preview shows
  those *same* 7 canned `DEMO_PLAYLISTS`, so the flagged subset and the match targets share an
  id namespace (local state, no server). Options: show all 7 pre-selected; restrict the reveal
  to flagged ids; or cosmetic (always show canned matches). **Flag to the human before
  implementing.** See the refined note in Phase 5.

---

## Phase 1 — Reorder steps + handle migration + guard tests — ✅ DONE (2026-06-16)

> **✅ Completed.** What actually shipped, including work the original file list under-specified:
> - **Steps file** (`onboarding-steps.ts`): both tuples reordered; `clearsSyncPhaseJobIds`
>   boundary `claim-handle` → `pick-color` (+ comment).
> - **Migration** `20260616140000_recreate_claim_handle_rpc_reorder.sql`: gate →
>   `('claim-handle','plan-selection','complete')`; both advances → `'plan-selection'`.
>   Applied to local DB; `pg_get_functiondef` verified.
> - **Navigation rewiring (the big gap the plan only hinted at via "audit next-step logic"):**
>   the flow is a *hardcoded chain*, not tuple-derived. Reordering the tuple alone does NOT
>   reroute the flow, and changing only the RPC advance would *orphan the demo steps*. Rewired
>   5 transitions: `WelcomeStep`→`flag-playlists`, `WalkthroughMatchContent`→`install-extension`,
>   `SyncingStep`→`pick-color`, `PickColorStep`→`claim-handle`, RPC claim→`plan-selection`.
>   (Unchanged & still correct: flag-playlists→pick-demo-song, pick-demo-song→song-walkthrough,
>   song-walkthrough→match-walkthrough, install-extension→syncing, plan-selection→complete.)
> - **Tests beyond the one the plan named:** `onboarding-steps.test.ts`,
>   `SyncingStep.test.tsx` (advance → pick-color), `onboarding-session.test.ts` (the
>   **inversion**: handle-less users on flag-playlists/pick-demo-song are no longer pinned —
>   the demo now runs without a handle), and the live-DB `claim-handle.integration.test.ts`
>   (advance → plan-selection; not_ready list expanded to all 8 pre-claim steps; cases 3/8
>   repurposed off `pick-demo-song`, now `not_ready`, onto `plan-selection`).
> - **Stale comments** fixed across `account-handle.functions.ts`, `onboarding.functions.ts`,
>   `DevWorkflowPanel.tsx`, `useOnboardingNavigation.ts`, `SyncingStep.tsx`, `onboarding-session.ts`.
> - **Verify results:** unit/onboarding suites 228 passed; integration 25 passed (local DB);
>   `bun run typecheck` 0 errors.
> - **Carried into later phases:** (a) `onboarding.tsx:98-104` auto-skips flag-playlists when
>   the user has no playlists — pre-sync that's always true, so flag-playlists is currently
>   skipped; Phase 2/3 must neutralize this. (b) `song-walkthrough`/`match-walkthrough` route
>   to `/liked-songs`/`/match` which have no pre-sync data until Phase 5. Phase 1 is a
>   structural checkpoint, **not** a runnable demo.

**Goal:** the 11 steps run in the new order; the handle RPC and sync-job boundary stay
consistent; all guard tests green. No UI changes.

**Files:**
- `src/lib/domains/library/accounts/onboarding-steps.ts`
  - Reorder `ONBOARDING_STEP_VALUES` to the new order (table above).
  - Reorder `SAVEABLE_ONBOARDING_STEP_VALUES` to match (still excludes `complete`).
  - `clearsSyncPhaseJobIds`: the "sync done" boundary is currently `claim-handle`. In the
    new order the first post-`syncing` step is **`pick-color`** — change the boundary to
    `pick-color` and update the WHY comment (jobs clear once sync finishes, i.e. at/after
    `pick-color`).
- New migration `supabase/migrations/<ts>_recreate_claim_handle_rpc_reorder.sql`
  (`<ts>` = a timestamp later than `20260609050728`; copy the existing RPC file and modify):
  - `v_existing_step NOT IN (...)` gate → the new "claim-handle onward" slice:
    `'claim-handle', 'plan-selection', 'complete'`.
  - Post-claim advance: every `onboarding_step = 'flag-playlists'` → `'plan-selection'`
    (the step now after `claim-handle`). There are two such updates in the function.
- `src/lib/domains/library/accounts/__tests__/onboarding-steps.test.ts`
  - Fix order-dependent expectations: `getPreviousOnboardingStep` / `getNextOnboardingStep`
    pairs, `isOnboardingStepBefore` examples, the `clearsSyncPhaseJobIds` pre/post lists
    (pre-sync now = `welcome, flag-playlists, pick-demo-song, song-walkthrough,
    match-walkthrough, install-extension, syncing`; clearing = `pick-color` onward), and the
    tripwire's `expectedSteps` (auto-derives from the tuple — just ensure the SQL matches).
- Check for other order assumptions: `grep -rn "flag-playlists\|claim-handle\|pick-color" src --include=*.ts --include=*.tsx` and audit any hardcoded "next step" logic (e.g.
  `useStepNavigation`, `onboarding-session.ts`, server onboarding functions).

**Verify:**
- `bun run test` — `onboarding-steps.test.ts` and any onboarding-session/preferences tests
  green.
- Apply the migration locally (supabase) and confirm `claim_handle` recreates without error.
- Manually trace: claiming a handle at `claim-handle` advances to `plan-selection`.

**Gotchas:** the post-claim advance has no test — verify by hand. Don't rename steps (only
reorder) or you trigger a wider migration surface.

---

## Phase 2 — Preview-routing skeleton (`flag-playlists` → real `/playlists`) — ✅ DONE (2026-06-16)

> **✅ Completed.** All six audit corrections re-verified against live code first; all held. What shipped:
> - **`onboarding-session.ts`:** `OnboardingMode` gains `"playlist-preview"`; `sessionMode()` returns it
>   for `flag-playlists` (new `case`, with WHY comment). No external exhaustive switch over `OnboardingMode`
>   exists, so the union widen was safe.
> - **`step-resolver.ts`:** `/playlists` added to `AllowedPath`; `resolveSession(flag-playlists)` → `/playlists`
>   (moved out of the `/onboarding` fallthrough group); `isPathAllowed` now prefix-matches
>   (`pathname === p || pathname.startsWith(p + "/")`) so `/playlists/$playlistRef` stays allowed. Other
>   allowed paths have no children, so prefix-matching is a no-op for them.
> - **`route.tsx`:** `showShell` now also true for `mode === "playlist-preview"`; `showSidebar={isComplete}`
>   left untouched (preview gets shell, no sidebar). `match.tsx:45` (`=== "walkthrough"`) unaffected.
> - **`Onboarding.tsx`:** `flag-playlists` STEP_CONFIG → `render: () => null, hideIndicator: true` (defensive —
>   the guard reroutes before the orchestrator renders); dropped the now-unused `FlagPlaylistsStep` import.
>   (`StepContext.playlists` left in place — its only reader was this step; removing the field is Phase 6 cleanup.)
> - **`onboarding.tsx` route:** deleted BOTH the `flag-playlists → pick-demo-song` auto-skip (old `:98-104`)
>   and the `isAutoSkipFlagPlaylists` special-case (old `:73-76`) + its `&& !isAutoSkipFlagPlaylists` guard
>   clause. `data` is still returned in context, so no unused-var fallout.
> - **`playlists.tsx`:** now reads `onboardingSession` from route context (mirrors `liked-songs.tsx`); computes
>   `isPlaylistPreview` and renders a hidden no-op slot (`<div data-onboarding-preview="flag-playlists" hidden />`)
>   as the Phase-3 mount point. **Deviation from the audit's "empty fragment" suggestion:** Biome rejects a
>   single-child/redundant fragment (and dropping it would make `isPlaylistPreview` an unused var), so a hidden
>   marker div is the lint-clean equivalent.
> - **Tests:** `step-resolver.test.ts` (flag-playlists→/playlists, `sessionMode`→playlist-preview, new
>   `isPathAllowed` prefix-match block incl. the `/playlists-archive` negative); `useStepNavigation.test.ts`
>   (+flag-playlists→`/playlists`, no `?step=`); `onboarding-flow.test.tsx` (**removed** the now-dead
>   `"renders flag-playlists step"` block — Phase 2 nulls that render; the inert `vi.mock`s stay for Phase 6 to
>   strip); `ClaimHandleStep.test.tsx` Test 6 (**repurposed** off `flag-playlists`, which now routes to
>   `/playlists`, onto `plan-selection` — the real post-claim target that still exercises the `/onboarding?step=`
>   branch this test guards).
> - **Verify:** targeted onboarding suites 82 passed; full suite 2274 passed / 8 skipped / 0 failed;
>   `bun run typecheck` 0 errors; `biome check` clean on all touched files.
> - **Carried into Phase 3:** `playlists.tsx` still mounts the production, server-wired `PlaylistsCoverFlowScreen`
>   for preview users (pre-sync = empty playlists, renders gracefully; `usePlaylistSession` writes only on user
>   action, so mounting is side-effect-free). Phase 3 swaps in the sandbox screen + canned data at the hidden slot.

> **⚠ Audit corrections (2026-06-16):**
> - **CONFIRMED** — `OnboardingMode` is `"steps" | "walkthrough" | "complete"`
>   (`onboarding-session.ts:54`); `sessionMode()` returns `"steps"` for `flag-playlists` via
>   the `default` branch. Add `"playlist-preview"` to the union and a
>   `case "flag-playlists": return "playlist-preview"`.
> - **CONFIRMED** — `AllowedPath` = `/onboarding | /liked-songs | /match | /dashboard`
>   (`step-resolver.ts:3-7`); `resolveSession` maps `flag-playlists → /onboarding` today;
>   `isPathAllowed` is strict equality (`:38-43`). Plan's edits are correct.
> - **CORRECTION (route.tsx)** — `showShell` is `isComplete || mode === "walkthrough"`
>   (~`:174`). `showSidebar` is **not a variable**: it's the hardcoded prop
>   `showSidebar={isComplete}` on `AuthenticatedShell` (~`:239`) — so "sidebar stays
>   isComplete only" needs *no* change. The `match.tsx` guard is at **`:45`** (`sessionMode(...)
>   === "walkthrough"`), not `:36`; unaffected (playlist-preview users never reach `/match`).
> - **GAP — the auto-skip WILL fight this (must neutralize).** `onboarding.tsx:98-104` redirects
>   `flag-playlists → pick-demo-song` whenever `data.playlists.length === 0`. Pre-sync that is
>   *always* true. Once `resolveSession` routes flag-playlists→`/playlists`, the `_authenticated`
>   guard redirects there *before* `onboarding.tsx` runs, so the skip is dead for the normal
>   path — but it still fires on any `/onboarding?step=flag-playlists` (dev panel, stale cache,
>   rollback). **Phase 2 should delete the auto-skip AND the `isAutoSkipFlagPlaylists`
>   special-case (`:73-76`)** — both are dead/harmful post-routing.
> - **GAP — `playlists.tsx` is not onboarding-aware at all.** It only passes `accountId` to
>   `PlaylistsCoverFlowScreen` + renders `<Outlet/>`. The mirror pattern is in `liked-songs.tsx`:
>   route reads `onboardingSession` from `Route.useRouteContext()` → passes as prop → page
>   checks `status`. Replicate that.
> - **NOTE — `useStepNavigation` (`:42-49`)** branches `allowedPath === "/onboarding"`; for
>   `/playlists` it takes the `else` (`router.navigate({to:"/playlists"})`) and does **not** pass
>   `?step=`. That's fine *iff* `/playlists` identifies the onboarding context from the session
>   (it does, via route context) — confirm in testing. `Onboarding.tsx` STEP_CONFIG change is
>   defensive only (the orchestrator won't render flag-playlists anymore); when setting
>   `render: () => null`, also drop the now-unused `FlagPlaylistsStep` import.

**Goal:** when a user is on `flag-playlists`, they're routed to the real `/playlists`
screen rendered in preview chrome (shell, no sidebar) — exactly like the `song-walkthrough`
→ `/liked-songs` handoff. **No canned data yet, no copy.**

**Files:**
- `src/lib/domains/library/accounts/onboarding-session.ts` — add `"playlist-preview"` to
  `OnboardingMode`; `sessionMode()` returns it for `flag-playlists`.
- `src/features/onboarding/step-resolver.ts` — add `"/playlists"` to `AllowedPath`; map
  `flag-playlists → /playlists` in `resolveSession`; make `isPathAllowed` prefix-match so
  `/playlists/$playlistRef` passes: `pathname === allowedPath || pathname.startsWith(allowedPath + "/")`. Keep other paths strict (none have children today).
- `src/routes/_authenticated/route.tsx` — `showShell` also true for
  `mode === "playlist-preview"`; `showSidebar` stays `isComplete` only. Confirm the
  `sessionMode` caller at `match.tsx:36` (`=== "walkthrough"`) is unaffected.
- `src/features/onboarding/Onboarding.tsx` — `flag-playlists` STEP_CONFIG →
  `render: () => null`, `hideIndicator: true` (defensive; users route to `/playlists`).
- `src/routes/_authenticated/playlists.tsx` — read the onboarding session from route context
  (confirm it's present; `liked-songs.tsx` shows the pattern). Add the structural branch for
  `status === "flag-playlists"` but render only a **no-op placeholder** sibling for now
  (e.g. an empty fragment or a `TODO(copy)` marker) — the banner/continue UI is Phase 3.

**Verify:**
- `bun run test` — update `step-resolver.test.ts` (flag-playlists → /playlists;
  `sessionMode(flag-playlists) === "playlist-preview"`; `isPathAllowed("/playlists/x")`).
- Manual: a fresh account at `flag-playlists` lands on `/playlists` with shell + no sidebar;
  a completed user sees the normal `/playlists` (no preview chrome).

**Gotchas:** don't couple `PlaylistsCoverFlowScreen` to onboarding — keep the onboarding
branch in the route (`playlists.tsx`), not the screen component.

---

## Phase 3 — Sandbox data in the `/playlists` preview — ✅ DONE (2026-06-16)

> **✅ Completed.** Built the audit's RECOMMENDED REVISION (a parallel sandbox screen, not a `sandbox?`
> prop). All audit corrections re-verified against live code first; all held. What shipped:
> - **`demo-matches.ts`:** `export`ed `DEMO_PLAYLISTS` + the `DemoPlaylist` type. The `reason` blurbs are
>   **kept on the data** (not mapped to intent) so Phase 4 can reuse them as ready-made intent examples —
>   per the human's note. No copy added.
> - **New `src/features/playlists/SandboxPlaylistsCoverFlowScreen.tsx`:** drives the already-presentational
>   `CoverFlowPlaylists` + `SpotlightPanel` from local `useState` — `targetIds: Set`, `metadata: Map<id,{intent,
>   genres}>`, `selectedId`. Shapes `DEMO_PLAYLISTS → PlaylistSummary` with `imageUrl` from the optional
>   `DemoPlaylist.imageUrl` (all 7 covers in `/public/demo-playlists/`, **webp q80**, capped at 1000px longest
>   edge — `crying-in-the-car`, `golden hour bike ride`, `feeling-everything`, `main-character-energy`
>   (top-cropped), `3am-thoughts` (left-cropped), `sunday-softness`, `revenge-era`; folder ≈304K total),
>   `songCount: 0` (keeps the
>   panel's "No tracks yet" honest), `tracks={[]}`. Local open (no route nav) sidesteps the `$playlistRef` loader
>   that bounces canned ids. (Also renamed demo id "2" `"sweaty and happy"` → `"golden hour bike ride"`.)
>   Mirrors the production screen's `lastShown` pattern for a clean close slide-out. **Nothing hits the server.**
> - **`playlists.tsx`:** loader **skips** the production `playlistManagementQueryOptions` fetch when
>   `onboardingSession.status === "flag-playlists"` (context carries the session, like `match.tsx`). Component
>   branches to a `PlaylistsPreview` that renders the sandbox screen + a fixed continue bar
>   (`useStepNavigation().navigateTo("pick-demo-song")`, `disabled` while pending). Continue does **not** persist
>   targets — it's a rehearsal; local state is discarded. Button label is a `TODO(copy)` placeholder (Phase 7).
>
> **Human decisions made this phase (D-Phase3):**
> - **Initial matching state = NONE flagged.** All 7 start in the Library rail; the Matching cover-flow opens
>   empty and renders `CoverFlowShelf`'s polished "No matching candidates yet" invitation (existing prod copy).
>   The user flags playlists into matching themselves — teaches the flag action from a clean slate.
> - **Intents start BLANK** (`intent: null`), not pre-filled from `reason`. The user writes/picks an intent via
>   the existing `WritingSurface` edit mode (Phase 4 adds the shuffle to make this one-click).
>
> **Carried into Phase 5 (refines D1):** the flagged set is now **local sandbox state that starts empty** — there's
> no pre-flagged subset to key the match reveal off. If Phase 5 wants "restrict the reveal to flagged ids," that
> set is whatever the user flagged in this rehearsal (and it doesn't survive the `navigateTo` to pick-demo-song —
> the sandbox screen unmounts). Most coherent options remain (a) show all 7 or (c) cosmetic canned matches.
>
> **Verify:** `bun run typecheck` 0 errors; `biome check` clean (after import-organize); full suite 2274 passed /
> 8 skipped / 0 failed. No new test file — the sandbox screen is thin local-state glue over already-tested
> presentational components, and an integration render would need the keyboard/animation provider stack for
> little signal. Visual confirmation (covers, flag toggle, panel) is an in-app check, not yet run.

> **⚠ Audit corrections (2026-06-16):**
> - **CONFIRMED** — `DEMO_PLAYLISTS` is 7 entries `{id,name,reason}`, ids `"1"`–`"7"`, not
>   exported (`demo-matches.ts:25-53`). `getDemoMatchesForSong` exported with a default-track
>   fallback (`:182`).
> - **CORRECTION — `PlaylistSummary` is much richer than `{id,name,reason}`**
>   (`explorations/types.ts:12-22`): `{ id, name, isTarget: boolean, songCount: number,
>   imageUrl: string|null, intent: string|null, genres: string[] }`. The canned data lacks
>   `isTarget`, `songCount`, `imageUrl`, `genres`, and has no real `intent`. **Decision needed:**
>   map `reason → intent` (pre-fills the writing surface as if already written) or start
>   `intent: null` and keep `reason` only for a copy blurb; pick a placeholder/CDN `imageUrl`
>   (covers are the visual centrepiece — blank without it); set `songCount` to `0` so the
>   detail panel shows "No tracks yet" rather than a misleading "+N more". Add a shaping
>   helper (`DEMO_PLAYLISTS → PlaylistSummary`) when exporting.
> - **CORRECTION — the "thin sandbox prop" approach is more invasive than the plan implies.**
>   `PlaylistsCoverFlowScreen` props are just `{ accountId }` (`:32-34`) and it is *deeply*
>   server-wired: `useQuery(playlistManagementQueryOptions)` (`:57`), `usePlaylistSession`
>   (`:62`, fires RPCs), `savePlaylistMatchIntent`/`savePlaylistGenrePills` (`:142-145`), and
>   `open(id)` resolves through `routeRefById` built from **real DB rows** (`:125-132`).
> - **GAP — detail navigation hard-blocks canned ids.** `SpotlightPanel` itself navigates
>   nothing; `open()` pushes `/playlists/$playlistRef`, whose loader (`playlists.$playlistRef.tsx`)
>   re-resolves against real playlists and **redirects to `/playlists` for unknown ids** — so
>   canned ids `"1"`–`"7"` bounce straight back. Tracks load via
>   `useInfiniteQuery(playlistTracksInfiniteQueryOptions(selectedId))`; with no real id,
>   `selectedId` is null → tracks `[]` (TrackList renders "No tracks yet" gracefully).
>   `buildPlaylistRouteRef` needs a real `Playlist` row, not a `PlaylistSummary`.
> - **RECOMMENDED REVISION** — don't bolt a `sandbox?` prop onto `PlaylistsCoverFlowScreen`
>   (every server hook + the open()/`$playlistRef` flow would need conditionals). Instead build
>   a parallel **`SandboxPlaylistsCoverFlowScreen`** that reuses the already-presentational,
>   prop-driven `CoverFlowPlaylists` + `SpotlightPanel` directly, with local `useState` for
>   targets/drafts, a local-state open (no route navigation), and `tracks=[]`. The route
>   (`playlists.tsx`) renders the sandbox screen when `onboardingSession.status ===
>   "flag-playlists"`, the production screen otherwise.

**Goal:** in preview mode the real screen shows the **canned** playlists and its actions
(flag as target, edit description/genres) run on **local in-memory state** — nothing hits
the server (the demo ids aren't real rows).

**Files / approach:**
- `src/lib/content/landing/demo-matches.ts` — export `DEMO_PLAYLISTS` (and/or a helper that
  shapes them into the screen's `PlaylistSummary` type:
  `src/features/playlists/components/explorations/types.ts`).
- `src/features/playlists/PlaylistsCoverFlowScreen.tsx` — it currently loads
  `playlistManagementQueryOptions(accountId)` and uses `usePlaylistSession` (server-backed
  toggle) + `savePlaylistMatchIntent`/`savePlaylistGenrePills`. Introduce a **sandbox path**:
  either a prop (`sandbox?: { playlists, onToggleTarget, onSaveMetadata }`) injected by the
  route in preview mode, or a small context. When sandbox is present, the screen renders the
  same `CoverFlowPlaylists` + `SpotlightPanel` but reads the canned list and routes actions
  to local state instead of the query/mutations. Prefer a thin wrapper so the production path
  is untouched.
- `src/routes/_authenticated/playlists.tsx` — in the `flag-playlists` branch, build the
  in-memory sandbox (canned playlists + `useState` for targets/descriptions) and pass it in.
  Replace the Phase-2 placeholder with the real continue affordance, but **no copy**
  (`TODO(copy)` placeholders).

**Verify:**
- Manual: in preview, the 7 canned playlists render; flagging toggles them between
  matching/library locally; opening one and editing its description updates local state; no
  network calls fire; refresh resets (expected — it's a rehearsal).
- `bun run test` green.

**Gotchas:** `SpotlightPanel` opens via `/playlists/$playlistRef` and loads tracks via an
infinite query — in sandbox there are no real tracks. Decide minimal handling (empty
tracks, or skip the detail open) and note it. Don't persist anything.

---

## Phase 4 — Salvage the intent shuffle into the real writing surface — ✅ DONE (2026-06-16)

> **✅ Completed.** All audit corrections re-verified against live code first; all held. What shipped:
> - **Moved** `DescriptionExamplesShuffle.tsx` `onboarding/components/` → `playlists/components/explorations/`
>   via `git mv` (history preserved). **Deviation from the plan's `components/` suggestion:** placed it inside
>   `explorations/` (sibling to `WritingSurface`/`SpotlightPanel`, its only forward consumer) for cohesion +
>   a short relative import. Its CSS is **global** (`styles.css:840-967`), so no CSS move was needed.
> - **Stale comment fixed** — the file's header claimed genres are "illustrative (never inserted)" and named
>   "the first-pick dialog"; both false now. Rewrote it to describe the real behavior (fills surface +
>   inserts genres + opens editor) while keeping the WHY about canonical genre forms. (Code comment, not
>   user-facing copy — outside the copy-freeze.)
> - **`OnboardingDescriptionDialog.tsx`** import repointed to the new absolute path so it keeps compiling
>   until Phase 6 deletes it (biome re-sorted the import; clean).
> - **Wired into `explorations/SpotlightPanel.tsx`** (NOT `PlaylistWritingSurface` — confirmed wrong target):
>   added a `pickExample(desc, genres)` handler that seeds `draftDescription`/`draftGenres` and opens the
>   editor (mirrors the dialog's `handlePickExample`, bypassing `openEditor`'s reseed-from-saved).
> - **Shuffle shows in EDIT mode only, below Save/Cancel** (human direction, 2026-06-16 — iterated twice):
>   rendered in `SpotlightPanel` as a sibling **below** the masthead band (and thus below the editor's
>   Save/Cancel), gated on `isEditing`, aligned to `max-w-[56ch]`. Applies to **all** users (production +
>   sandbox). An interim build put it in an `editExtras` slot *inside* the band above Save/Cancel — reverted.
> - **Theming/legend fix by placement, not CSS trick:** the box sits on the panel's plain `theme-bg`
>   (`= var(--t-bg)`), which is exactly what `.desc-examples-legend`'s notch paints with — so the "EXAMPLES"
>   legend blends with zero override. (The interim build placed it on the tinted band and tried to remap the
>   legend bg via a `--desc-examples-legend-bg` CSS var; that didn't reliably blend, so both the var and the
>   band override were reverted — `styles.css` legend rule is back to plain `var(--t-bg)`.)
> - **Walkthrough decluttering** (human direction, 2026-06-16): added `hideUnmatchableWarning` (`WritingSurface`)
>   and `hideEmptyState` (`TrackList`), surfaced on `SpotlightPanel` as `hideUnmatchableWarning` /
>   `hideTracksEmptyState`; `SandboxPlaylistsCoverFlowScreen` sets both. In the flag-playlists rehearsal the
>   "can't be matched yet" caution and the "No tracks yet" empty state are hidden (canned playlists start empty,
>   so both are noise). Production unaffected — props default `false`.
> - **Bonus (free):** `SpotlightPanel` is shared by **both** `PlaylistsCoverFlowScreen` (production `/playlists`)
>   and `SandboxPlaylistsCoverFlowScreen` (Phase 3 onboarding preview), so one change lands the shuffle in both —
>   it helps all real users *and* enriches the onboarding rehearsal. Save still routes through each screen's own
>   `onSave` (production mutations vs. local sandbox state).
> - **Genres inserted (preserved)** — examples have ≤3 genres (under `GENRE_MAX` 5) in canonical whitelist forms,
>   feeding the same `../GenrePillsPicker` the production save path already uses. No new behavior.
> - **Per-playlist intent examples (new file `src/lib/content/landing/demo-intent-examples.ts`).** The salvage
>   went past a single generic pool: each demo playlist (`DEMO_PLAYLISTS` ids `"1"`–`"7"`) now shows its **own
>   three** tuned intents. `DescriptionExamplesShuffle` gained an optional `examples?` prop (falls back to the
>   generic `EXAMPLES` when omitted); `SpotlightPanel` threads `examples` through; `SandboxPlaylistsCoverFlowScreen`
>   passes `DEMO_INTENT_EXAMPLES[panelPlaylist.id]`. Production `/playlists` passes nothing → unchanged generic
>   shuffle. Phrases are written for the cold-start matcher (intent = whole profile for an empty playlist), each
>   naming a compound mood + concrete scene + sonic cue. Genres are ≤3/example, all canonical whitelist forms
>   (verified against `lastfm/whitelist.ts`), so they survive `sanitizeGenrePills` as real pills. **Structure note:**
>   `DemoIntentExample` (data) and `DescriptionExample` (widget) are kept as two identical shapes on purpose — it
>   keeps `lib/content` free of a UI-component type import; the prop accepts the data via structural typing.
> - **Re-tuned `DEMO_SONG_MATCHES` (phase-5 reveal data, pulled forward for coherence).** All ~20 demo songs were
>   re-scored against the new per-playlist *intents* (mood/scene/sonic cues), not just titles — so each song lands
>   in several playlists at honest strengths and off-vibe pairings drop (e.g. "Not Like Us" is now 2 matches, not
>   3). Scores descend within each song. This is Phase-5 match-reveal data edited *now* only to stay consistent
>   with the intents a user picks in the rehearsal (see the Phase 5 carry-in note). No test asserts these scores
>   (both consumers mock `getDemoMatchesForSong`), but the data also feeds the **public landing page**
>   (`Landing.tsx`), so the re-tune is live there too. Also re-compressed
>   `public/demo-playlists/feeling-everything.webp` (22.6K → 12.4K).
> - **Verify:** `bun run typecheck` 0 errors; `biome check` clean on all touched files; playlists + onboarding
>   suites **118 passed**. No new test (self-contained widget over already-tested presentational components, same
>   reasoning as Phase 3). Visual confirmation (shuffle renders, Pick fills + opens editor, Save persists) is an
>   in-app check, not yet run.
>   **Re-verified at review (2026-06-16)** with the per-playlist examples + match re-tune in tree: typecheck +
>   biome clean; playlists + onboarding + matching + demo-matches + whitelist suites = **158 passed**.
> - **Carried into Phase 6:** the shuffle now lives in playlists, so Phase 6 has **nothing to delete** for it
>   (resolves the Phase 6 "ADD to delete list — DescriptionExamplesShuffle" branch — it was *moved*, not
>   orphaned). The dialog's absolute import to the moved shuffle dies with the dialog. `PlaylistWritingSurface`
>   (+ `.stories.tsx`) is still only used by the dialog → confirm-and-delete in Phase 6 (no consolidation needed;
>   `explorations/WritingSurface` is the surviving surface).

> **⚠ Audit corrections (2026-06-16) — the original Files list targets the WRONG component:**
> - **WRONG TARGET** — the plan says graft onto `PlaylistWritingSurface.tsx` via its "caller
>   `SpotlightPanel.tsx`". But **`SpotlightPanel` does not use `PlaylistWritingSurface`** — it
>   imports a local `./WritingSurface` (`explorations/WritingSurface.tsx`). And
>   `PlaylistWritingSurface`'s only production importer is `OnboardingDescriptionDialog.tsx`
>   (deleted in Phase 6), so it's effectively dead. **Real target: `explorations/SpotlightPanel.tsx`
>   + `explorations/WritingSurface.tsx`** (the surface shipped on `/playlists` via
>   `PlaylistsCoverFlowScreen`).
> - **CONFIRMED** — `DescriptionExamplesShuffle` has 12 examples and emits
>   `onPick(description: string, genres: readonly string[])` (`:54-58`, fired `:94`);
>   self-contained; sole importer `OnboardingDescriptionDialog.tsx`. `genres` is `string[]` on
>   both sides — no conversion.
> - **WIRING** — the shuffle is rendered by the **caller**, outside the surface, gated on
>   `!isEditing` (as `OnboardingDescriptionDialog` does today). `SpotlightPanel` already owns the
>   draft state (`description/genres/isEditing/draftDescription/draftGenres`, `:49-55`; seed via
>   `openEditor()` `:74`). So `onPick` → `setDraftDescription(d)`, `setDraftGenres([...g])`,
>   `setIsEditing(true)`. Neither writing-surface component needs a new prop slot (its `editFooter`
>   only shows in edit mode — wrong place for the shuffle).
> - **CORRECTION — genres are INSERTED, not "illustrative-only."** `OnboardingDescriptionDialog.
>   handlePickExample` (`:133-141`) sets *both* `draftDescription` and `draftGenres` then opens
>   the editor; on save both persist. The "(illustrative)" note in `DescriptionExamplesShuffle`'s
>   own header describes the widget's default intent but the dialog overrides it. **Preserve the
>   insert behavior** in the new caller.
> - **GAP — fate of `PlaylistWritingSurface.tsx` + `.stories.tsx`.** After Phase 6 deletes
>   `OnboardingDescriptionDialog`, `PlaylistWritingSurface` has zero non-story callers. **Decide:**
>   delete it in Phase 6 (likely), or consolidate `explorations/WritingSurface` into it. Don't
>   leave two parallel writing surfaces.
> - **NOTE — moving the shuffle file** breaks `OnboardingDescriptionDialog.stories.tsx` (and any
>   stories) imports; those die with Phase 6 anyway. No unit tests reference the shuffle.

**Goal:** the intent "shuffle" (pick a ready-made description) appears in the real playlist
detail editor for **all** users; selecting one fills the draft and opens the editor.

**Files:**
- `src/features/onboarding/components/DescriptionExamplesShuffle.tsx` — move it out of the
  onboarding folder into playlists (e.g. `src/features/playlists/components/`), since it's no
  longer onboarding-specific. Keep the `onPick(description, genres)` API.
- `src/features/playlists/components/PlaylistWritingSurface.tsx` (presentational, caller owns
  draft) and its caller `SpotlightPanel.tsx` — render the shuffle in edit mode; wire
  `onPick` → set `draftDescription` + `draftGenres` + ensure edit mode is open. Read the
  surface's existing draft props/handlers first; reuse them, don't add a parallel state.
- Decide whether picked genres are inserted or illustrative-only (the old dialog treated the
  shuffle's genres as illustrative — check `OnboardingDescriptionDialog.tsx` wiring before
  removing it in Phase 6, and preserve that intended behavior).

**Verify:** opening a real playlist's editor shows the shuffle; Pick fills the textarea +
genres; Save persists (production path). `bun run test` green; move/Update any
`DescriptionExamplesShuffle` test references.

---

## Phase 5 — Fully-fake match reveal + `/liked-songs` sandbox

> **⚠ Audit corrections (2026-06-16):**
> - **CONFIRMED** — `WalkthroughMatchContent.tsx` has the full real-matching path:
>   `matchReducer` (`:53-98`), poll loop + `TIMEOUT_MS = 12_000` (`:146-201`), dev-pane
>   real/fallback toggle (`:288-356`). `getDemoMatchesForSong` is already the fallback source
>   (`:110-118`). `MatchingSession` (`sections/MatchingSession.tsx`) is purely presentational —
>   keep it. `navigateTo("install-extension")` (`:223`) is the Phase 1 change — leave it.
> - **GAP — removing the UI poll does NOT fully dead-code the preview workflow.**
>   `getDemoSongMatches` (server fn, `onboarding.functions.ts:733`) loses its only production UI
>   caller (`WalkthroughMatchContent` `:15,164`); remaining refs are the test stub
>   (`__mocks__/onboarding.functions.stub.ts:95`) and `onboarding.demo-matches.test.ts`. BUT the
>   `walkthrough-match-preview` job is *also* triggered by write paths — `savePlaylistTargets`
>   (`:584-592`) and `commitDemoSongAndEnterWalkthrough` (`:699-703`) — plus the worker
>   (`src/worker/poll-walkthrough-preview.ts`, `walkthrough-preview-queue.ts`). Those become
>   *unnecessary* in a fully-fake flow but won't error. Inventory before deleting; don't rip out
>   the worker blindly.
> - **CONFIRMED — `/liked-songs` already works pre-sync via a synthetic song.** `isWalkthrough`
>   derives from `onboardingSession?.status === "song-walkthrough"` (`LikedSongsPage.tsx:52-56`).
>   `useLikedSongsCollection` builds a synthetic `LikedSong` from the walkthrough song and pins it
>   to the top even when the `liked_song` table is empty. Queries key on `account_id`, **not**
>   Spotify OAuth — no `spotify_id` requirement. **Caveat:** only **one** song is pinned today; a
>   multi-song sandbox needs the collection hook to accept a list, and `landing-songs` manifests
>   are selection-shaped, not `WalkthroughSong`-shaped (the demo songs do exist as `song` rows;
>   `loadWalkthroughSong` enriches from DB).
> - **CONFIRMED** — route guards permit `/liked-songs` for `song-walkthrough` and `/match` for
>   `match-walkthrough` (`step-resolver.ts:19-35`).
>
> **⚠ Phase-4 carry-in (2026-06-16):** `DEMO_SONG_MATCHES` was **re-tuned during Phase 4** — re-scored against
> the per-playlist intents in `demo-intent-examples.ts` (so "Not Like Us" dropped from 3 matches to 2, etc.).
> Reason about D1 against the *current* scores, not the pre-phase-4 data. This only changed the canned match
> *targets/strengths*; the reveal still ignores the flagged set today.
>
> **D1 (picked playlists vs canned matches) — refined:** today `WalkthroughMatchContent` ignores
> playlist selection entirely; the reveal is independent of what the user flagged. The original
> D1 framing assumed `flag-playlists` shows *real* Spotify playlists (true only in the old code).
> **After Phase 3, `flag-playlists` shows the 7 canned `DEMO_PLAYLISTS` (ids `"1"`–`"7"`) — the
> same id namespace `DEMO_SONG_MATCHES` already targets.** So the flagged subset and the match
> targets finally share a key space, which makes all three options coherent and wireable:
> (a) show all 7 pre-selected; (b) restrict the reveal to flagged ids; (c) cosmetic — always show
> the canned matches. **Still a human decision** — but note the wiring is now local-state only
> (the flagged set from Phase 3's sandbox), no server. Flag before implementing.

**Goal:** the demo runs end-to-end with **no** real data or background jobs. Resolve **D1**
(picked playlists vs canned matches) with the human first.

**Files:**
- `src/features/matching/WalkthroughMatchContent.tsx` — remove the real-matching path
  (`getDemoSongMatches` polling, the 12s timeout/fallback reducer machinery, the dev-pane
  real/fallback toggle). Use `getDemoMatchesForSong(spotifyTrackId)` directly. Keep the
  same presentational `MatchingSession`.
- `src/lib/server/onboarding.functions.ts` — `getDemoSongMatches` and the
  `walkthrough-match-preview` workflow may become dead for onboarding; **don't delete**
  blindly (grep usages — landing/devtools may rely on them). Note what becomes unused.
- `/liked-songs` preview (`song-walkthrough`): in the new order this runs **before sync**,
  so there are no real liked songs. Feed canned songs (the `landing-songs` set) into
  `LikedSongsPage` when `onboardingSession.status === "song-walkthrough"`. Inspect
  `src/features/liked-songs/LikedSongsPage.tsx` (`isWalkthrough` at ~52) and its data hooks
  to add a sandbox source, mirroring Phase 3's approach.

**Verify:** a fresh account, extension never installed, completes `flag-playlists` →
`pick-demo-song` → `song-walkthrough` → `match-walkthrough` entirely on canned data, then
proceeds to `install-extension`. `bun run test` green.

**Gotchas:** confirm the route guards (`isPathAllowed`) still permit `/liked-songs` and
`/match` for these steps in the new order. The demo must not require `spotify_id`
(null pre-sync).

---

## Phase 6 — Retire bespoke flag components

> **⚠ Audit corrections (2026-06-16):**
> - **Clarify scope** — Phase 6 removes the bespoke *components*, NOT the `flag-playlists`
>   *step*. The step token stays in the domain (`onboarding-steps.ts`, `step-resolver.ts`,
>   sessions) — it's just preview-routed (Phase 2). Don't touch those references.
> - **Files exist:** `FlagPlaylistsStep.tsx`, `OnboardingDescriptionDialog.tsx` +
>   `OnboardingDescriptionDialog.stories.tsx`, `FlagPlaylistsStep.test.tsx`. There is **no**
>   `FlagPlaylistsStep.stories.tsx` and **no** `DescriptionExamplesShuffle.stories.tsx` — the
>   plan's "if it stayed behind" is moot.
> - **ADD to delete list — `DescriptionExamplesShuffle.tsx`.** Its only importer is
>   `OnboardingDescriptionDialog`. If Phase 4 *moves* it into playlists, nothing to delete; if
>   Phase 4 reuses the existing `explorations/WritingSurface` and does NOT need it, this file is
>   orphaned → delete. Reconcile with Phase 4's final approach.
> - **ADD to delete list — `PlaylistWritingSurface.tsx` + `PlaylistWritingSurface.stories.tsx`**
>   (see Phase 4): orphaned once `OnboardingDescriptionDialog` is gone. Confirm no consolidation
>   first.
> - **`onboarding-flow.test.tsx` needs surgery (not just FlagPlaylistsStep.test.tsx deletion):**
>   remove the `useFlagPlaylistsScroll` vi.mock (`:33`) and `OnboardingDescriptionDialog` vi.mock
>   (`:54`), and delete the `"renders flag-playlists step"` test block (`:150-156`).
> - **`savePlaylistTargets`** (server fn `onboarding.functions.ts:554` + stub
>   `__mocks__/onboarding.functions.stub.ts:91`) loses all production callers when
>   `FlagPlaylistsStep` goes. Prune or note as dead. (Cross-check Phase 5: it also triggers the
>   walkthrough preview job — confirm that path is already retired.)
> - **CONFIRMED keep — `useFlagPlaylistsScroll.ts`**: `PickDemoSongStep.tsx:22,51` uses it
>   (and `src/test/mocks.ts:61` stubs it). Do not delete.
> - **Ordering:** `Onboarding.tsx` must drop the `flag-playlists` STEP_CONFIG render + import
>   (Phase 2 already nulls the render) *before* `FlagPlaylistsStep.tsx` can be deleted.

**Goal:** remove the old onboarding-specific flag UI now that the real screen + shuffle
cover it.

**Delete (after confirming no remaining imports):**
- `src/features/onboarding/components/FlagPlaylistsStep.tsx`
- `src/features/onboarding/components/OnboardingDescriptionDialog.tsx` (+ `.stories.tsx`)
- `src/features/onboarding/__tests__/FlagPlaylistsStep.test.tsx`
- `DescriptionExamplesShuffle.stories.tsx` if it stayed behind after the Phase 4 move.

**Keep:** `src/features/onboarding/hooks/useFlagPlaylistsScroll.ts` — `PickDemoSongStep`
still uses it.

**Verify:** `grep -rn "FlagPlaylistsStep\|OnboardingDescriptionDialog"` returns nothing in
`src`. `bun run test` green. `Onboarding.tsx` no longer imports the deleted components.

---

## Phase 7 — Copy pass (deferred)

Not for an agent. After the structure works, the human and assistant tune copy
interactively, screen by screen: welcome (done), the `/playlists` preview guidance,
`pick-demo-song`, `song-walkthrough`, `match-walkthrough`, and the connect/personalize
steps. Replace every `TODO(copy)` left by earlier phases.
