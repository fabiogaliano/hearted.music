# Implementation Plan: `pick-demo-song` onboarding step

> **Future-state plan.** The `pick-demo-song` step, `demo_song_id` column, and seed script do not exist yet.

## Goals

- Users pick their own demo song during onboarding (replaces hardcoded `DEMO_SONG_ID` env var)
- Showcase steps read from `user_preferences.demo_song_id` instead of env var
- `pick-demo-song` is mandatory (no skip), inserted between `flag-playlists` and `song-showcase`

## Schema change

New migration `20260407000000_add_demo_song_id.sql`:

`ALTER TABLE user_preferences ADD COLUMN demo_song_id UUID REFERENCES song(id) ON DELETE SET NULL;`

Nullable — only populated once the user picks a song.

## Seed script

`scripts/seed-landing-songs.ts` — reads all `public/landing-songs/*.json` detail files, upserts into `song` table by `spotify_id`. Fields mapped: `name`, `artists` (as array), `album_name`, `image_url`, `genres`, `spotify_id`.

No `song_analysis` seeding — analyses are produced by running the existing pipeline against the seeded songs.

Safe to run repeatedly (upsert on `spotify_id`). Uses `createAdminSupabaseClient`.

## Demo match data

Extract archetype playlists and per-song match scores from `Landing.tsx` into `src/lib/data/demo-matches.ts`:

- `DEMO_PLAYLISTS` — 7 archetype playlists (renamed from `PLAYLISTS`), typed as `DemoPlaylist[]`
- `DEMO_SONG_MATCHES` — per-song top-3 scores keyed by `spotifyTrackId` (renamed from `SONG_PLAYLIST_MATCHES`), entries typed as `DemoSongMatch`
- `getDemoMatchesForSong(spotifyTrackId: string): DemoMatchPlaylist[]` — lookup helper that joins `DEMO_SONG_MATCHES` with `DEMO_PLAYLISTS`, returns `DemoMatchPlaylist[]` (same shape as server response). Used by both `getDemoSongMatches` server function and `MatchShowcaseStep` timeout fallback.

Shared by the landing page and `getDemoSongMatches` (no-playlists path). No DB rows — purely static data used for the demo match showcase when the user has no target playlists.

## Server functions

### New: `saveDemoSongSelection`

In `src/lib/server/onboarding.functions.ts`.

- Input: `{ spotifyTrackId: string }` (validated with `z.object({ spotifyTrackId: z.string() })`)
- Looks up `song` row by `spotify_id` → gets UUID
- Updates `user_preferences.demo_song_id` for the authenticated user
- Returns `{ success: true }`
- Throws `OnboardingError("lookup_demo_song", ...)` if song not found
- Throws `OnboardingError("save_demo_song_selection", ...)` if update fails

### Updated: `getDemoSongShowcase`

- Read `demo_song_id` from `user_preferences` (via `getOrCreatePreferences`) instead of `env.DEMO_SONG_ID`
- If `null`, return `null` (same as today's "no env var" path)
- Add `spotifyTrackId: string` to `DemoSongData.song` (needed by `MatchShowcaseStep` to look up demo matches on timeout)

### Updated: `getDemoSongMatches`

- Read `demo_song_id` from `user_preferences` instead of env var
- If `null`, return `{ status: "unavailable" }`
- Add `isDemo: boolean` to `DemoMatchResult`'s `"ready"` variant: `{ status: "ready"; matches: DemoMatchPlaylist[]; isDemo: boolean }`
- **No target playlists path:** Before looking for a real match snapshot, check if the user has any target playlists. If none, look up the demo song's `spotify_id` and return `{ status: "ready", matches, isDemo: true }` built from demo archetype data (`demo-matches.ts`). No polling needed — server returns immediately.
- Real matches path: return `{ status: "ready", matches, isDemo: false }`
- Component maps `isDemo` directly from server response — no client-side heuristic needed.

### Cleanup

- Remove `DEMO_SONG_ID` from `src/env.ts` (schema + runtimeEnv)
- Remove `DEMO_SONG_ID` mock from `src/lib/server/__tests__/onboarding.free-allocation.test.ts`
- Add `saveDemoSongSelection` stub to `src/__mocks__/onboarding.functions.stub.ts`

### Renames in `MatchShowcaseStep.tsx`

- Remove `CANNED_MATCHES` constant entirely
- `isCanned` → `isDemo` on `MatchState["ready"]`
- Update all copy branches that check `isCanned` to use `isDemo`
- **Timeout fallback:** When polling times out (user has playlists but matching is slow), call `getDemoMatchesForSong(spotifyTrackId)` from `demo-matches.ts` using the chosen demo song's `spotifyTrackId` (from `DemoSongData.song.spotifyTrackId`). Same data as the no-playlists path. Sets `isDemo: true`.
- **Copy when `isDemo: true`:** subtitle "Here's what to expect", heading "Here's how songs find their playlists.", footer "These are example matches — yours will be based on your real playlists."

## UI component: `PickDemoSongStep`

`src/features/onboarding/components/PickDemoSongStep.tsx`

- **Layout:** Standard centered wrapping grid (not full-bleed), fits in `StepContainer`
- **Header:** "Step 04" label, heading "Pick a *song*", subtitle "It'll be used to show you how hearted. listens."
- **Grid:** 3-4 column wrapping grid of song cards
- **Card:** Album art + song name + artist name. Unselected: grayscale + dimmed. Selected: full color. Focused: dashed outline.
- **Selection:** Single-select. Clicking a new card deselects the previous.
- **Continue button:** "Continue" — disabled until a song is selected
- **No skip button**
- **Keyboard:** Arrow key navigation via `useListNavigation` (direction: `"grid"`), Space to select, Enter to continue (via `useShortcut`)
- **On continue:** Calls `saveDemoSongSelection({ data: { spotifyTrackId } })`, then `goToStep("song-showcase")`
- **Props:** `{ songs: LandingSongManifest[] }` — passed from route loader via `OnboardingData`

## Wiring

### `ONBOARDING_STEPS` (`preferences-queries.ts`)

Add `"pick-demo-song"` between `"flag-playlists"` and `"song-showcase"` in the zod enum.

### `STEP_CONFIG` (`Onboarding.tsx`)

```ts
"pick-demo-song": {
  render: (ctx) => <PickDemoSongStep songs={ctx.landingSongs} />,
}
```

Not full-bleed, not hideIndicator.

### `StepContext` / `OnboardingData`

Add `landingSongs: LandingSongManifest[]` to both `OnboardingData` and `StepContext`.

### Route loader (`onboarding.tsx`)

Load landing songs manifest server-side in `getOnboardingData` by importing from the existing `landing-songs.server.ts` module (Vite-bundled via `import.meta.glob`, runtime-agnostic — no `fs`). Add a `getLandingSongsManifest()` export to that module and call it from `getOnboardingData`. Include the result in `OnboardingData`.

### Navigation changes

- `FlagPlaylistsStep`: continue → `goToStep("pick-demo-song")`, skip → `goToStep("pick-demo-song")`
- Route `beforeLoad` auto-skip: no playlists → redirect to `"pick-demo-song"` instead of `"song-showcase"`
- Update `isAutoSkipFlagPlaylists` guard: change expected forward-jump target from `"song-showcase"` to `"pick-demo-song"`
- Add `"pick-demo-song"` to the `clearPhaseJobIds` list in `saveOnboardingStep`

## Edge cases

| Case | Behavior |
|------|----------|
| No playlists | Skip `flag-playlists` → `pick-demo-song` → `song-showcase` (real analysis) → `match-showcase` (demo archetype playlists from `demo-matches.ts`, keyed by chosen demo song, `isDemo: true`) |
| Refresh on `pick-demo-song` | Step is saved to DB, route resumes correctly |
| Demo song has no analysis yet | `getDemoSongShowcase` returns `null` → existing "unavailable" state in `SongShowcaseStep` |
| Seed script not run | `saveDemoSongSelection` fails → error toast, user can't proceed (deployment bug) |
| User already has the song as a liked song | No conflict — `demo_song_id` references the same `song` row |

## Resolved decisions

| Decision | Resolution |
|----------|------------|
| Step position | Between `flag-playlists` and `song-showcase` |
| Skippable? | No |
| No-playlists flow | Skip flag-playlists → pick-demo-song → song-showcase (real DB analysis) → match-showcase (demo archetype matches, no polling, `isDemo: true`) |
| Demo match data | Extracted to `src/lib/data/demo-matches.ts` as `DEMO_PLAYLISTS`, `DEMO_SONG_MATCHES`, `getDemoMatchesForSong()`. Shared by landing page and `getDemoSongMatches` |
| Seed script scope | `song` table only, no `song_analysis` |
| Analysis for demo songs | Produced by existing pipeline, not seeded |
| Layout | Standard centered grid, not full-bleed |
| Card content | Album art + song name + artist |
| Selection | Single-select, grayscale/full-color toggle |
| Header copy | "Pick a *song*" / "It'll be used to show you how hearted. listens." |
| Continue label | "Continue" |
| Step label | "Step 04" |
| `DEMO_SONG_ID` env var | Removed entirely |

## Sequencing

1. DB migration (`demo_song_id` column)
2. Seed script (`scripts/seed-landing-songs.ts`)
3. Extract demo match data to `src/lib/data/demo-matches.ts` (`DEMO_PLAYLISTS`, `DEMO_SONG_MATCHES`, `getDemoMatchesForSong`), update `Landing.tsx` to import from it
4. `saveDemoSongSelection` server function
5. Update `getDemoSongShowcase` + `getDemoSongMatches` to read from `user_preferences` (with demo archetype fallback for no-playlists path)
6. Remove `DEMO_SONG_ID` from env
7. Add `"pick-demo-song"` to `ONBOARDING_STEPS`
8. Load landing songs in `getOnboardingData` + add to `OnboardingData`
9. Build `PickDemoSongStep` component
10. Wire into `STEP_CONFIG`, update `FlagPlaylistsStep` navigation, update route `beforeLoad` skip logic
11. Regenerate `database.types.ts`
