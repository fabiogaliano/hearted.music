# Terminology: `pick-demo-song` onboarding step

> Canonical names locked for schema, RPCs, types, modules, env vars, and UI copy.
> Source of truth for all implementation work on this feature.

## Schema

| Term | Canonical name | Location |
|------|---------------|----------|
| DB column | `demo_song_id` | `user_preferences` table |
| Column type | `UUID REFERENCES song(id) ON DELETE SET NULL` | Nullable |
| Migration file | `20260407000000_add_demo_song_id.sql` | `supabase/migrations/` |

## Step identifier

| Term | Canonical name | Location |
|------|---------------|----------|
| Step enum value | `"pick-demo-song"` | `ONBOARDING_STEPS` zod enum in `preferences-queries.ts` |
| Position | Between `"flag-playlists"` and `"song-showcase"` | — |

## Server functions

| Term | Canonical name | Location |
|------|---------------|----------|
| Save demo song choice | `saveDemoSongSelection` | `onboarding.functions.ts` |
| Input schema | `z.object({ spotifyTrackId: z.string() })` | — |
| Input param key | `spotifyTrackId` | Matches `LandingSongManifest.spotifyTrackId` |
| Error op: song lookup | `"lookup_demo_song"` | `OnboardingError` first arg |
| Error op: save | `"save_demo_song_selection"` | `OnboardingError` first arg |
| Get demo showcase | `getDemoSongShowcase` | Already exists, updated to read from `user_preferences` |
| Get demo matches | `getDemoSongMatches` | Already exists, updated to read from `user_preferences` |

## Types

| Term | Canonical name | Location |
|------|---------------|----------|
| Demo song showcase data | `DemoSongData` | `onboarding.functions.ts` (existing) |
| New field on song object | `DemoSongData.song.spotifyTrackId` | `string` |
| Demo match result union | `DemoMatchResult` | `onboarding.functions.ts` (existing) |
| New field on ready variant | `isDemo: boolean` | `{ status: "ready"; matches: DemoMatchPlaylist[]; isDemo: boolean }` |
| Component match state | `MatchState` | `MatchShowcaseStep.tsx` (local type) |
| Renamed flag | `isDemo` | Replaces `isCanned` everywhere |
| Archetype playlist type | `DemoPlaylist` | `demo-matches.ts` |
| Archetype match entry | `DemoSongMatch` | `demo-matches.ts` |

## Components

| Term | Canonical name | Location |
|------|---------------|----------|
| Step component | `PickDemoSongStep` | `src/features/onboarding/components/PickDemoSongStep.tsx` |
| Props type | `PickDemoSongStepProps` | Same file, inline interface |
| Props shape | `{ songs: LandingSongManifest[] }` | — |

## Data modules

| Term | Canonical name | Location |
|------|---------------|----------|
| Demo match data module | `src/lib/data/demo-matches.ts` | New file |
| Archetype playlists export | `DEMO_PLAYLISTS` | `demo-matches.ts` |
| Per-song match map export | `DEMO_SONG_MATCHES` | `demo-matches.ts` |
| Lookup helper | `getDemoMatchesForSong(spotifyTrackId: string): DemoMatchPlaylist[]` | `demo-matches.ts` |
| Server manifest loader | `getLandingSongsManifest()` | `landing-songs.server.ts` |

## OnboardingData / StepContext

| Term | Canonical name | Location |
|------|---------------|----------|
| Landing songs field | `landingSongs: LandingSongManifest[]` | `OnboardingData` + `StepContext` |

## Env vars

| Term | Action |
|------|--------|
| `DEMO_SONG_ID` | **Removed** from `src/env.ts` (schema + runtimeEnv) |
| Replacement | None — demo song ID now lives in `user_preferences.demo_song_id` |

## Seed script

| Term | Canonical name |
|------|---------------|
| Script file | `scripts/seed-landing-songs.ts` |

## Removals / Renames

| Old name | New name / action | Location |
|----------|------------------|----------|
| `CANNED_MATCHES` | **Removed** — replaced by `getDemoMatchesForSong()` | `MatchShowcaseStep.tsx` |
| `isCanned` | `isDemo` | `MatchShowcaseStep.tsx` local `MatchState` |
| `PLAYLISTS` | `DEMO_PLAYLISTS` | Extracted from `Landing.tsx` → `demo-matches.ts` |
| `SONG_PLAYLIST_MATCHES` | `DEMO_SONG_MATCHES` | Extracted from `Landing.tsx` → `demo-matches.ts` |
| `DEMO_SONG_ID` env var | Removed | `src/env.ts` |

## User-facing copy

### PickDemoSongStep

| Element | Copy |
|---------|------|
| Step label | "Step 04" |
| Heading | "Pick a *song*" (italic on "song") |
| Subtitle | "It'll be used to show you how hearted. listens." |
| Continue button | "Continue" |

### MatchShowcaseStep (isDemo=true)

| Element | Copy |
|---------|------|
| Subtitle (above matches) | "Here's what to expect" |
| Heading | "Here's how songs find their playlists." |
| Footer note | "These are example matches — yours will be based on your real playlists." |

### MatchShowcaseStep (isDemo=false) — unchanged

| Element | Copy |
|---------|------|
| Subtitle | "Your matches" |
| Heading | "We found where this song belongs." |
