# Locked Decisions: `pick-demo-song`

> **Purpose:** Zero-ambiguity reference for parallel implementers.
> Every decision here is final — do not reinterpret.
> Source plan: `docs/pick-demo-song-plan.md`
> Source terminology: `docs/runbooks/pick-demo-song-terminology.md`

---

## 1. Product Invariants

| # | Decision | Detail |
|---|----------|--------|
| P1 | Step is mandatory | No skip button. No way to bypass `pick-demo-song`. |
| P2 | Step position | `flag-playlists` → **`pick-demo-song`** → `song-showcase`. Exactly between these two, no conditional reordering. |
| P3 | Step label | `"Step 04"` — hardcoded string, not computed from step index. |
| P4 | Single-select | Exactly one song selected at a time. Clicking a new card deselects the previous. No multi-select. |
| P5 | Continue button | Label: `"Continue"`. Disabled until a song is selected. No other actions on this button. |
| P6 | Heading copy | Heading: `"Pick a *song*"` (italic on "song"). Subtitle: `"It'll be used to show you how hearted. listens."` Exactly this copy. |
| P7 | No-playlists flow | `flag-playlists` auto-skips → `pick-demo-song` → `song-showcase` (real DB analysis) → `match-showcase` (demo archetype matches via `demo-matches.ts`, `isDemo: true`, no polling). |
| P8 | Song count | 20 songs from `public/landing-songs/index.json`. This is the full set shown in the grid. |
| P9 | Card content | Album art + song name + artist name. No genre, no duration, no other metadata. |
| P10 | Card visual states | Unselected: grayscale + dimmed. Selected: full color. Focused: dashed outline. |

## 2. Architecture Invariants

| # | Decision | Detail |
|---|----------|--------|
| A1 | `DEMO_SONG_ID` env var removed entirely | Delete from `src/env.ts` (schema + runtimeEnv). No replacement env var. Demo song ID lives in `user_preferences.demo_song_id` per-user. |
| A2 | Demo match data is static, no DB | `DEMO_PLAYLISTS`, `DEMO_SONG_MATCHES`, `getDemoMatchesForSong()` live in `src/lib/data/demo-matches.ts`. Extracted from `Landing.tsx`. Shared by landing page and server function. |
| A3 | Landing songs loaded via Vite `import.meta.glob` | No `fs` calls. `landing-songs.server.ts` uses `import.meta.glob` (already exists). Add `getLandingSongsManifest()` export that returns the manifest array. Runtime-agnostic. |
| A4 | Seed script: `song` table only | `scripts/seed-landing-songs.ts` upserts songs by `spotify_id`. No `song_analysis` rows seeded. Analyses come from running the existing pipeline against seeded songs. |
| A5 | Seed script is idempotent | Upserts on `spotify_id`. Safe to run repeatedly. Uses `createAdminSupabaseClient`. |
| A6 | `PickDemoSongStep` is not full-bleed | Standard centered wrapping grid inside `StepContainer`. `hideIndicator` is false. |
| A7 | `Landing.tsx` imports from `demo-matches.ts` | After extraction, `Landing.tsx` imports `DEMO_PLAYLISTS` and `DEMO_SONG_MATCHES` from the new module. The constants are deleted from `Landing.tsx`. |
| A8 | Timeout fallback is client-side | When polling times out in `MatchShowcaseStep`, call `getDemoMatchesForSong(spotifyTrackId)` directly from `demo-matches.ts` (client-side import). No server round-trip for fallback. |

## 3. Data Model Invariants

| # | Decision | Detail |
|---|----------|--------|
| D1 | Column: `user_preferences.demo_song_id` | Type: `UUID`. Nullable. FK to `song(id)`. `ON DELETE SET NULL`. |
| D2 | Migration file | `supabase/migrations/20260407000000_add_demo_song_id.sql` |
| D3 | Migration SQL | `ALTER TABLE user_preferences ADD COLUMN demo_song_id UUID REFERENCES song(id) ON DELETE SET NULL;` Exactly this. No default, no NOT NULL. |
| D4 | Null semantics | `demo_song_id = NULL` means user hasn't picked yet. `getDemoSongShowcase` returns `null`. `getDemoSongMatches` returns `{ status: "unavailable" }`. |
| D5 | No cascade delete to preferences | `ON DELETE SET NULL` — if the song row is deleted, the preference silently becomes null. User sees "unavailable" in showcase steps. |

## 4. Server Contract Invariants

| # | Decision | Detail |
|---|----------|--------|
| S1 | `saveDemoSongSelection` input | `z.object({ spotifyTrackId: z.string() })`. Takes Spotify track ID, not song UUID. Server resolves to UUID via `song.spotify_id` lookup. |
| S2 | `saveDemoSongSelection` success | Returns `{ success: true }`. No other fields. |
| S3 | `saveDemoSongSelection` errors | Song not found → `OnboardingError("lookup_demo_song", ...)`. Update fails → `OnboardingError("save_demo_song_selection", ...)`. These throw (not return). |
| S4 | `getDemoSongShowcase` change | Reads `demo_song_id` from `user_preferences` via `getOrCreatePreferences`. If null → return `null`. Adds `spotifyTrackId: string` to `DemoSongData.song`. |
| S5 | `getDemoSongMatches` — ready variant | Type becomes `{ status: "ready"; matches: DemoMatchPlaylist[]; isDemo: boolean }`. New `isDemo` field. |
| S6 | `getDemoSongMatches` — no-playlists path | Check user's target playlists first. If none → look up demo song's `spotify_id` → build matches from `getDemoMatchesForSong()` → return `{ status: "ready", matches, isDemo: true }`. No polling, immediate return. |
| S7 | `getDemoSongMatches` — real matches path | Return `{ status: "ready", matches, isDemo: false }`. |
| S8 | `getDemoSongMatches` — null demo_song_id | Return `{ status: "unavailable" }`. |
| S9 | `isDemo` is authoritative | Component reads `isDemo` from server response. No client-side heuristic (e.g., match count, playlist names). |

## 5. Rename Invariants

| # | Old | New | Location |
|---|-----|-----|----------|
| R1 | `isCanned` | `isDemo` | `MatchShowcaseStep.tsx` local `MatchState`, all conditionals |
| R2 | `CANNED_MATCHES` | **Removed** | `MatchShowcaseStep.tsx` — replaced by `getDemoMatchesForSong()` call |
| R3 | `PLAYLISTS` | `DEMO_PLAYLISTS` | Extracted from `Landing.tsx` → `demo-matches.ts` |
| R4 | `SONG_PLAYLIST_MATCHES` | `DEMO_SONG_MATCHES` | Extracted from `Landing.tsx` → `demo-matches.ts` |

## 6. Navigation Invariants

| # | Decision | Detail |
|---|----------|--------|
| N1 | `FlagPlaylistsStep` continue | `goToStep("pick-demo-song")` (was `"song-showcase"`) |
| N2 | `FlagPlaylistsStep` skip | `goToStep("pick-demo-song")` (was `"song-showcase"` / `"ready"`) |
| N3 | Auto-skip guard update | `isAutoSkipFlagPlaylists` in route `beforeLoad`: change target from `"song-showcase"` to `"pick-demo-song"`. Condition: `search.step === "pick-demo-song" && savedStep === "flag-playlists" && data.playlists.length === 0`. |
| N4 | `clearPhaseJobIds` list | Add `"pick-demo-song"` to the steps that trigger `clearPhaseJobIds` in `saveOnboardingStep`. |
| N5 | `PickDemoSongStep` continue | Calls `saveDemoSongSelection`, then `goToStep("song-showcase")`. |

## 7. UI Copy Invariants (isDemo states)

| # | Context | Element | Copy |
|---|---------|---------|------|
| C1 | `MatchShowcaseStep`, `isDemo: true` | Subtitle | `"Here's what to expect"` |
| C2 | `MatchShowcaseStep`, `isDemo: true` | Heading | `"Here's how songs find their playlists."` |
| C3 | `MatchShowcaseStep`, `isDemo: true` | Footer | `"These are example matches — yours will be based on your real playlists."` |
| C4 | `MatchShowcaseStep`, `isDemo: false` | Subtitle | `"Your matches"` |
| C5 | `MatchShowcaseStep`, `isDemo: false` | Heading | `"We found where this song belongs."` |

## 8. Keyboard Invariants

| # | Decision | Detail |
|---|----------|--------|
| K1 | Grid navigation | `useListNavigation` with `direction: "grid"`. Arrow keys navigate the grid. (Hook already supports `"grid"` direction with `columns` param.) |
| K2 | Select | Space to select/deselect a song card. |
| K3 | Continue | Enter to continue (via `useShortcut`), same as clicking Continue button. Only fires when a song is selected. |

## 9. Wiring Invariants

| # | Decision | Detail |
|---|----------|--------|
| W1 | `ONBOARDING_STEPS` enum | Add `"pick-demo-song"` between `"flag-playlists"` and `"song-showcase"` in the zod enum array. |
| W2 | `STEP_CONFIG` entry | `"pick-demo-song": { render: (ctx) => <PickDemoSongStep songs={ctx.landingSongs} /> }`. Not full-bleed, not hideIndicator. |
| W3 | `OnboardingData` | Add `landingSongs: LandingSongManifest[]`. |
| W4 | `StepContext` | Add `landingSongs: OnboardingData["landingSongs"]`. |
| W5 | Route loader | `getOnboardingData` calls `getLandingSongsManifest()` from `landing-songs.server.ts`. Includes result in `OnboardingData`. |
| W6 | `database.types.ts` | Must be regenerated after migration (step 11 in sequencing). |

## 10. Test Invariants

| # | Decision | Detail |
|---|----------|--------|
| T1 | Remove `DEMO_SONG_ID` mock | Delete from `src/lib/server/__tests__/onboarding.free-allocation.test.ts`. |
| T2 | Add stub | Add `saveDemoSongSelection` to `src/__mocks__/onboarding.functions.stub.ts`. |

## 11. Deployment Invariants

| # | Decision | Detail |
|---|----------|--------|
| DEP1 | Migration must run before deploy | `demo_song_id` column must exist before new code reads it. |
| DEP2 | Seed script must run before users onboard | If seed hasn't run, `saveDemoSongSelection` fails because no `song` rows match. This is a deployment bug, not a user error. |
| DEP3 | Pipeline must run against seeded songs | Demo songs need `song_analysis` rows to show showcase data. Pipeline runs after seeding. |

---

## 12. Resolved Open Questions

All questions below were raised during extraction and resolved before implementation.

| # | Question | Resolution |
|---|----------|------------|
| Q1 | Grid column count | 4 cols desktop (≥768px) / 3 cols tablet / 2 cols mobile. Responsive via CSS grid breakpoints. |
| Q2 | Manifest ordering in `getLandingSongsManifest()` | Shuffled once per page load (server-side). Different users see different orders, stable within session. |
| Q3 | Back navigation from `pick-demo-song` | No back button. One-way flow. |
| Q4 | Error UX when `saveDemoSongSelection` fails | Error toast (`"Something went wrong. Please try again."`), stay on step, Continue re-enabled for retry. Selection preserved. |
| Q5 | Re-visiting `pick-demo-song` after picking | No pre-selection. Grid starts fresh. User picks again (overwrites previous). |
| Q6 | `useListNavigation` columns param | Hardcode `columns: 4`. Keyboard nav slightly off on smaller screens but functional. No dynamic sync. |
| Q7 | Error toast copy | `"Something went wrong. Please try again."` — consistent with other onboarding error toasts. |
| Q8 | `getDemoMatchesForSong()` fallback | Return empty array `[]` if `spotifyTrackId` not in map. No default-song fallback. All 20 landing songs have entries, so this is a safety net only. |
| Q9 | Loading state on Continue | No loading indicator. No disable during save. Rely on navigation happening quickly. |
| Q10 | `syncStats` passthrough | `FlagPlaylistsStep` passes `syncStats` to `pick-demo-song` via `goToStep` state. `PickDemoSongStep` reads `syncStats` from `location.state` and forwards via `goToStep("song-showcase", { syncStats })`. |

---

_No remaining open questions. All decisions locked for implementation._
