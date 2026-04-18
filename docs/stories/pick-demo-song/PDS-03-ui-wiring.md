# PDS-03: UI + wiring — PickDemoSongStep, step config, navigation, route loader

## Goal

Build the `PickDemoSongStep` component, register the new onboarding step, update the route loader to provide landing songs, rewire navigation so `flag-playlists` flows through `pick-demo-song`, and rename `isCanned` → `isDemo` in `MatchShowcaseStep`.

## Depends on / Blocks

- **Depends on:** PDS-02 (server functions, `isDemo` on `DemoMatchResult`, `spotifyTrackId` on `DemoSongData.song`)
- **Blocks:** nothing

## Scope

### In scope

1. **`ONBOARDING_STEPS` enum** in `src/lib/domains/library/accounts/preferences-queries.ts`
   - Add `"pick-demo-song"` between `"flag-playlists"` and `"song-showcase"`

2. **`PickDemoSongStep` component** `src/features/onboarding/components/PickDemoSongStep.tsx`
   - Props: `{ songs: LandingSongManifest[] }`
   - Layout: Standard centered wrapping grid in `StepContainer`
   - Header: "Step 04" label, "Pick a *song*" heading, "It'll be used to show you how hearted. listens." subtitle
   - Grid: 3–4 column wrapping grid of song cards
   - Card: Album art + song name + artist. Unselected: grayscale + dimmed. Selected: full color. Focused: dashed outline.
   - Single-select (clicking new card deselects previous)
   - "Continue" button, disabled until selection made. No skip.
   - Keyboard: Arrow key nav via `useListNavigation` (direction: `"grid"`), Space to select, Enter to continue (`useShortcut`)
   - On continue: call `saveDemoSongSelection({ data: { spotifyTrackId } })`, then `goToStep("song-showcase")`

3. **`STEP_CONFIG`** in `src/features/onboarding/Onboarding.tsx`
   - Add `"pick-demo-song"` entry: `render: (ctx) => <PickDemoSongStep songs={ctx.landingSongs} />`
   - Not full-bleed, not hideIndicator

4. **`StepContext` / `OnboardingData`** in `src/features/onboarding/Onboarding.tsx`
   - Add `landingSongs: LandingSongManifest[]` to both types

5. **Route loader** `src/routes/_authenticated/onboarding.tsx`
   - Import `getLandingSongsManifest()` from `landing-songs.server.ts` (add this export if needed)
   - Include result in `OnboardingData`

6. **Navigation changes**
   - `FlagPlaylistsStep.tsx`: continue → `goToStep("pick-demo-song")`, skip → `goToStep("pick-demo-song")`
   - Route `beforeLoad`: no playlists → redirect to `"pick-demo-song"` instead of `"song-showcase"`
   - `isAutoSkipFlagPlaylists` guard: change expected target from `"song-showcase"` to `"pick-demo-song"`
   - Add `"pick-demo-song"` to `clearPhaseJobIds` list in `saveOnboardingStep` (if applicable)

7. **`MatchShowcaseStep.tsx` renames**
   - Remove `CANNED_MATCHES` constant
   - `isCanned` → `isDemo` on `MatchState["ready"]`
   - Update all copy branches checking `isCanned` to use `isDemo`
   - Timeout fallback: call `getDemoMatchesForSong(spotifyTrackId)` from `demo-matches.ts` using `DemoSongData.song.spotifyTrackId`. Sets `isDemo: true`.
   - Copy when `isDemo: true`: subtitle "Here's what to expect", heading "Here's how songs find their playlists.", footer "These are example matches — yours will be based on your real playlists."

### Out of scope

- Server function changes (PDS-02)
- Migration / seed script (PDS-01)
- Storybook stories for `PickDemoSongStep` (can add later)

## Likely touchpoints

| Area | Files |
|------|-------|
| Step enum | `src/lib/domains/library/accounts/preferences-queries.ts` |
| New component | `src/features/onboarding/components/PickDemoSongStep.tsx` |
| Step config / types | `src/features/onboarding/Onboarding.tsx` |
| Route loader | `src/routes/_authenticated/onboarding.tsx` |
| Landing songs server | `src/lib/data/landing-songs.server.ts` (add `getLandingSongsManifest` export) |
| Flag playlists nav | `src/features/onboarding/components/FlagPlaylistsStep.tsx` |
| Match showcase | `src/features/onboarding/components/MatchShowcaseStep.tsx` |
| Demo match data | `src/lib/data/demo-matches.ts` (import for timeout fallback) |
| Onboarding tests | `src/features/onboarding/__tests__/onboarding-flow.test.tsx` |
| Function stubs | `src/__mocks__/onboarding.functions.stub.ts` |

## Constraints and decisions to honor

- Step position: between `flag-playlists` and `song-showcase` (plan: "Resolved decisions")
- Not skippable (plan: "Resolved decisions")
- Standard centered grid layout, not full-bleed (plan: "Resolved decisions")
- Single-select with grayscale/full-color toggle (plan: "Resolved decisions")
- Step label: "Step 04" (plan: "Resolved decisions")
- Header copy exactly as specified (plan: "Resolved decisions")
- Continue label: "Continue" (plan: "Resolved decisions")
- `isDemo` copy: "Here's what to expect" / "Here's how songs find their playlists." / "These are example matches — yours will be based on your real playlists." (plan: "Renames in MatchShowcaseStep.tsx")

## Acceptance criteria

- [ ] `"pick-demo-song"` appears in `ONBOARDING_STEPS` enum between `"flag-playlists"` and `"song-showcase"`
- [ ] `PickDemoSongStep` renders grid of song cards from `LandingSongManifest[]`
- [ ] Single-select: clicking a card selects it (full color), clicking another deselects previous
- [ ] Continue button disabled until selection; calls `saveDemoSongSelection` then navigates to `song-showcase`
- [ ] Keyboard navigation works: arrows move focus, Space selects, Enter continues
- [ ] No skip button present
- [ ] `FlagPlaylistsStep` continue and skip both navigate to `pick-demo-song`
- [ ] Route `beforeLoad`: no playlists → redirects to `pick-demo-song` (not `song-showcase`)
- [ ] `isAutoSkipFlagPlaylists` guard updated to expect `pick-demo-song`
- [ ] `MatchShowcaseStep`: `isCanned` fully renamed to `isDemo`, `CANNED_MATCHES` removed
- [ ] `MatchShowcaseStep` timeout fallback uses `getDemoMatchesForSong` with `spotifyTrackId`
- [ ] `isDemo: true` copy matches plan exactly
- [ ] Route loader provides `landingSongs` in `OnboardingData`
- [ ] `bun run test` passes
- [ ] TypeScript compiles cleanly
- [ ] Full onboarding flow works end-to-end: welcome → … → flag-playlists → pick-demo-song → song-showcase → match-showcase → …

## Notes on risks or ambiguity

- **Step numbering:** Adding a step between flag-playlists and song-showcase shifts all subsequent step numbers. The plan says "Step 04" — verify this is correct by counting existing steps. If other steps show step numbers, they may need updating.
- **`useListNavigation` with `"grid"` direction:** Verify this hook variant exists and handles 3–4 column layouts. If not, check what direction values are supported.
- **`clearPhaseJobIds` in `saveOnboardingStep`:** The plan mentions adding `"pick-demo-song"` to this list. Locate where this is defined and what it does — may be clearing async job references from previous phases.
- **Onboarding test updates:** `onboarding-flow.test.tsx` likely has step-order assertions that need updating for the new step insertion.
- **`getLandingSongsManifest` export:** The `landing-songs.server.ts` module already has the manifest data internally. Need to add a public export. Check if `manifest` is already exported or needs a wrapper function.
