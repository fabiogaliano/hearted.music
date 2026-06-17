# Onboarding changeset — review findings & fix tasks

Compiled from two review passes over the current working-tree diff (vs `HEAD`):

1. **Leakage pass** — lens: *"these changes should only affect onboarding; production must work as
   normal; no leakage."*
2. **Architecture pass** (`/improve-codebase-architecture`, scoped to this diff) — deepening /
   refactor opportunities.

The changeset is mostly well-isolated: the onboarding-*intended* behavior is gated behind props that
default to production values, or behind `walkthrough.isActive` / `isWalkthrough` (false in prod). The
items below are where that isolation breaks, plus a few refactors worth doing in the same area.

Tasks are ordered by priority. Each is independently actionable.

---

## Task 1 — Split the `match-review-queue` change out, then de-duplicate it

This file has nothing to do with onboarding and is the clearest scope leak. It's also internally
duplicated. Both sub-tasks live in the same separate PR.

**Files**
- `src/lib/domains/taste/match-review-queue/service.ts`
- `src/lib/domains/taste/match-review-queue/__tests__/service.test.ts`
- `claudedocs/match-review-queue-review-findings.md`

### 1a — Split out of the onboarding changeset (scope / leakage) — **do first**

`service.ts` rewrites `createOrResumeQueue` and `syncActiveQueue` to add a `hasSessionBeenSeeded`
race-condition guard. This is core production queue logic (entry points: `/match` route loader and the
background match-refresh completion handler) — unrelated to onboarding. It's deliberate and *tested*,
which is exactly why it shouldn't ride along in an "onboarding-only" change.

- [ ] Move `service.ts` + `service.test.ts` + `match-review-queue-review-findings.md` into their own
      commit/PR.
- [ ] Verify in isolation: `bun run test` for the match-review-queue suite passes on that branch alone.

### 1b — De-duplicate the caught-up → seeded → rollover sequence (architecture) — **do in that PR**

`createOrResumeQueue` (`service.ts:232`) and `syncActiveQueue` (`service.ts:544`) implement the **same**
three-branch decision tree for an existing active session:

> count unresolved → if in-progress, append latest snapshot → else if the session isn't seeded yet,
> append (don't roll over — a concurrent creator is mid-seed) → else complete the pass and create a
> fresh one from the latest snapshot.

The load-bearing invariant — *`completeSession` must leave `'active'` **before** the insert, because
`idx_match_review_session_one_active` rejects a second active row* — now has no single home. The two
copies differ only in their return vocabulary (`ActiveQueueResult` vs `AppendResult`). A future change to
the rollover policy (cooldown, different "seeded" definition) must touch both or they drift, and the two
entry points would diverge for no intended reason.

**Fix** — extract one deep module owning the decision tree for an existing active session (a *pass-advance
/ rollover* module) returning a small discriminated result (e.g. resumed-in-place / appended-while-seeding
/ rolled-over-and-created). The two entry points become thin adapters that map that result into their own
return shape. Helpers already in place to reuse: `hasSessionBeenSeeded` (`service.ts:112`),
`createQueueFromLatestSnapshot` (`service.ts:155`), `appendLatestSnapshot`, `completeSession`,
`countUnresolvedItems`.

- [ ] Extract the shared decision tree behind one interface.
- [ ] Reduce `createOrResumeQueue` / `syncActiveQueue` to result-mapping adapters.
- [ ] Re-point tests at the extracted module's interface (the seeded-race guard gets tested **once**,
      not in parallel through both entry points); keep a thin mapping test per adapter.

> Passes the deletion test: delete the extracted module and the invariant reappears in both callers.

---

## Task 2 — Decide & gate the shared playlist-panel production changes

`PlaylistsCoverFlowScreen.tsx` (the real `/playlists`) renders `CoverFlowPlaylists` and `SpotlightPanel`
from `components/explorations/`, so these are **shared production components**. The screen file itself is
unmodified and passes none of the guided props — but several edits to the shared components are
**unconditional** (not behind a guided/onboarding flag) and therefore change production. Decide per item
whether the prod change is intended; if not, gate it to the sandbox.

**Files** — all under `src/features/playlists/components/explorations/`.

### 2a — `SpotlightPanel`: intent editor now hidden until a playlist is in matching — **highest impact**

`SpotlightPanel.tsx:213` drives the writing-surface collapse off `playlist.isTarget`
(`gridTemplateRows: playlist.isTarget ? "1fr" : "0fr"`, plus `opacity-0` and `inert`), *not* off
`guidedIntent`. Previously `WritingSurface` rendered unconditionally. So on the real `/playlists`, opening
a playlist that **isn't** yet a matching candidate now collapses the intent editor and its hue band and
makes it inert — a prod user must "Add to matching" before they can write/edit intent. (Track list still
shows.)

- [ ] **Decision:** is "intent editor only after adding to matching" intended for production?
  - [ ] If **yes** — keep, but acknowledge it as a deliberate prod UX change (out of onboarding scope).
  - [ ] If **no** — gate the collapse so it only applies in guided/sandbox mode (e.g. expand-when-target
        only when `guidedIntent`/a sandbox flag is set), leaving prod showing the editor as before.

### 2b — `TargetToggle`: full rewrite lands in prod

Beyond the gated `pulse` prop, unconditional changes affect prod (used via `SpotlightHero` → `SpotlightPanel`
and `ShelfCaption`): `＋` glyph → `PlusIcon` (`TargetToggle.tsx:67`), new `min-w-[150px]` on the Add pill
(`:56`), transition `150ms` → `200ms` with a new ease, and new "suppress Remove on the add-click hover"
state (`removeSuppressed`, `:35`/`:37`). Likely intended polish, but it's a real prod interaction/visual
change.

- [ ] Confirm the rewrite is intended for production. If yes, keep (note as prod change). If not, isolate.

### 2c — `DescriptionExamplesShuffle`: `xpl-reveal` now always applied (minor)

`DescriptionExamplesShuffle.tsx:83` applies `xpl-reveal` in **both** variants, so the prod examples
shuffle (shown when editing a target playlist's intent) now mounts with a reveal animation it didn't have
before. Cosmetic.

- [ ] Confirm the reveal animation is wanted in prod, or scope `xpl-reveal` to the guided variant only.

### 2d — `CoverFlowPlaylists`: new wrapper `<div data-tour="matching">` (negligible)

`CoverFlowPlaylists.tsx:262` wraps the matching shelf in a layout-neutral block div; `data-tour`
attributes (`:186`, `:262`, `:280`) are inert in prod. No action needed beyond awareness.

- [ ] No change required — noted for completeness.

### Confirmed clean — properly gated, no prod leakage (no action, kept as a record)

These were verified during the leakage pass and are correctly isolated to onboarding. Listed so the
isolation work that *is* right doesn't get re-litigated.

- **liked-songs** (`SongCard`, `LikedSongsList`, `LikedSongsPage`): the new "new"-badge suppression, the
  dim-non-hero `isSongEnabled` logic, and the `TourCoachMark` all sit behind
  `isWalkthrough` / `walkthrough.isActive`, which is false in prod. `isWalkthrough` defaults to `false`
  on `SongCard`. ✓
- **`WalkthroughMatchContent.tsx`**: onboarding-only component; the finish-dialog change stays inside
  it. ✓
- **All guided props on the shared components** default to the exact prior production values, and the
  prod `PlaylistsCoverFlowScreen` (unmodified) passes none of them: `closable`, `highlightAdd`,
  `autoEditOnAdd`, `guidedIntent`, `intentPlaceholder`, `lockManualEntry`, `examplesSlot`, `hideRailAdd`,
  `matchingEmptyTitle/Body/Action`, `emptyTitle/Body/Action`, `hideUnmatchableWarning`,
  `hideTracksEmptyState`. ✓
- **`styles.css` `.desc-examples.guided`**: scoped to the `.guided` modifier, only added in the guided
  variant. The new `xpl-pulse` keyframe/class only applies where `xpl-pulse` is attached (all gated). ✓
- **New modules** (`SpotlightOverlay`, `TourCoachMark`, `playlistPreviewTour`): no module-level side
  effects — the `document.body` references are `createPortal` targets inside component bodies. The
  `PlaylistPreviewTourProvider` wraps only the preview branch in `playlists.tsx`; the real screen is
  untouched. ✓
- **Onboarding step files** (`InstallExtensionStep`, `PickDemoSongStep`): copy + responsive-rows
  changes, onboarding-only. ✓

---

## Task 3 — Consolidate the "guided" panel mode into one cohesive prop (architecture, optional)

**Files** — `SpotlightPanel.tsx`, `WritingSurface.tsx`, `CoverFlowPlaylists.tsx`.

The shared panel/writing-surface modules are absorbing onboarding concerns as a widening set of ~6
boolean/override props (`closable`, `highlightAdd`, `autoEditOnAdd`, `intentPlaceholder`, `guidedIntent`,
`lockManualEntry`, `examplesSlot`, `matchingEmpty*`, `hideRailAdd`). The interface is growing nearly as
fast as the behavior (getting shallower), and the flags aren't independent — `guidedIntent` is only
coherent with `closable={false}` + `autoEditOnAdd` + the guided `examplesSlot` + the CTA placeholder. The
type system permits incoherent subsets that never occur, and "what guided mode means" is reconstructed at
the one call site (`SandboxPlaylistsCoverFlowScreen`) rather than living in the panel.

**Strength / scope** — there is exactly **one** guided caller today, so this is an *emerging* shallowness,
not a full seam (one adapter = hypothetical seam; two = real). Proportionate move now:

- [ ] Collapse the guided flags into one cohesive prop — a `guided` config object or a
      `mode: "default" | "guided"` discriminated prop the panel expands internally — so illegal
      combinations are unrepresentable and "guided" has one definition.
- [ ] **Do not** extract a full seam yet. Revisit only if a second guided surface appears.

---

## Task 4 — Notes & verifications (low priority, mostly "decide, don't build")

### 4a — Onboarding coach-mark sequencing is implemented three ways (watch, no work)

`TourCoachMark` is cleanly presentational, but the *sequencing* around it is re-rolled per surface:
`playlistPreviewTour.tsx` (derived state machine + reporter — the good one), `playlists.tsx`
(`handoffDismissed` local boolean), `LikedSongsPage.tsx` (`walkthroughIntroDismissed`),
`WalkthroughMatchContent.tsx` (`finishing`). These differ in effect (macro `navigateTo` vs pure local
hint vs feeding the derived machine), so they don't trivially merge. A shared `useOneShotHint` would only
remove ~2–3 lines per site — shallow boilerplate, fails the deletion test.

The real architectural observation: onboarding now has **two sequencing models** — the macro,
server-persisted `useStepNavigation` / `OnboardingStep` model, and a new micro, in-page model that only
`PlaylistPreviewTour` formalizes.

- [ ] No work now. **If** micro-walkthroughs spread beyond `/playlists`, generalize the
      `PlaylistPreviewTour` "derive step from observable state" pattern per surface — not a shared hint
      component, and not folding micro-steps into the server-persisted `OnboardingStep` tuple.

### 4b — Verify `REQUIRED_FLAGGED_COUNT` `3 → 2` was intended

Moving the constant into `playlistPreviewTour.tsx:56` (now `2`, exported `:180`, consumed by the route at
`playlists.tsx:9`) also changed its value from `3` (previously defined locally in the route) to `2`.
Colocating it with the tour is reasonable; the value change may be unintended.

- [ ] Confirm the rehearsal should require **2**, not **3**, flagged playlists before Continue enables.

---

## Quick checklist (all tasks)

- [ ] **1a** Split `service.ts` (+ test + claudedoc) into its own PR; tests green in isolation.
- [ ] **1b** Extract the pass-advance/rollover module; entry points become adapters; tests re-pointed.
- [ ] **2a** Decide on `SpotlightPanel` collapse-until-target; gate to sandbox if not intended for prod.
- [ ] **2b** Confirm/scope the `TargetToggle` rewrite.
- [ ] **2c** Confirm/scope the `DescriptionExamplesShuffle` `xpl-reveal`.
- [ ] **2d** (awareness only) `CoverFlowPlaylists` wrapper div.
- [ ] **3**  Group the guided flags into one prop (optional; no seam yet).
- [ ] **4a** (watch only) two sequencing models.
- [ ] **4b** Verify `REQUIRED_FLAGGED_COUNT` `3 → 2`.
</content>
</invoke>
