# PDS-02: Server layer — save selection, update showcase/match RPCs, remove env var

## Goal

Wire up the server functions so the onboarding flow reads `demo_song_id` from `user_preferences` instead of `DEMO_SONG_ID` env var, add the save-selection RPC, integrate demo match data for the no-playlists path, and clean up the env var.

## Depends on / Blocks

- **Depends on:** PDS-01 (migration, `demo-matches.ts` module)
- **Blocks:** PDS-03 (UI needs these server functions)

## Scope

### In scope

1. **New server function: `saveDemoSongSelection`** in `src/lib/server/onboarding.functions.ts`
   - Input: `{ spotifyTrackId: string }` validated with zod
   - Looks up `song` row by `spotify_id` → gets UUID
   - Updates `user_preferences.demo_song_id` for authenticated user
   - Returns `{ success: true }`
   - Error: `OnboardingError("lookup_demo_song", ...)` if song not found
   - Error: `OnboardingError("save_demo_song_selection", ...)` if update fails

2. **Update `getDemoSongShowcase`**
   - Read `demo_song_id` from `user_preferences` (via `getOrCreatePreferences`) instead of `env.DEMO_SONG_ID`
   - If `null`, return `null`
   - Add `spotifyTrackId: string` to `DemoSongData.song` (needed by `MatchShowcaseStep` for timeout fallback lookup)

3. **Update `getDemoSongMatches`**
   - Read `demo_song_id` from `user_preferences` instead of env var
   - If `null`, return `{ status: "unavailable" }`
   - Add `isDemo: boolean` to `DemoMatchResult`'s `"ready"` variant
   - **No-playlists path:** If user has no target playlists, look up demo song's `spotify_id`, call `getDemoMatchesForSong()` from `demo-matches.ts`, return `{ status: "ready", matches, isDemo: true }` immediately (no polling)
   - Real matches path: return `{ status: "ready", matches, isDemo: false }`

4. **Remove `DEMO_SONG_ID` from env**
   - Remove from `src/env.ts` schema and `runtimeEnv`

5. **Update test/mock files**
   - Remove `DEMO_SONG_ID` mock from `src/lib/server/__tests__/onboarding.free-allocation.test.ts`
   - Add `saveDemoSongSelection` stub to `src/__mocks__/onboarding.functions.stub.ts`

### Out of scope

- UI components and step wiring (PDS-03)
- Seed script changes (done in PDS-01)
- `MatchShowcaseStep` client-side changes (PDS-03)

## Likely touchpoints

| Area | Files |
|------|-------|
| Server functions | `src/lib/server/onboarding.functions.ts` |
| Env config | `src/env.ts` |
| Test mocks | `src/lib/server/__tests__/onboarding.free-allocation.test.ts` |
| Function stubs | `src/__mocks__/onboarding.functions.stub.ts` |
| Demo match data | `src/lib/data/demo-matches.ts` (import `getDemoMatchesForSong`) |
| Preferences | `src/lib/domains/library/accounts/preferences-queries.ts` (read `demo_song_id`) |

## Constraints and decisions to honor

- `isDemo` replaces `isCanned` terminology everywhere (plan: "Renames in MatchShowcaseStep.tsx" — but the server-side type change happens here)
- No-playlists path returns demo archetype data immediately, no polling needed (plan: "Updated: getDemoSongMatches")
- `saveDemoSongSelection` uses `spotify_id` lookup, not UUID input (plan: "New: saveDemoSongSelection")
- `DEMO_SONG_ID` is removed entirely, not deprecated (plan: "Resolved decisions")

## Acceptance criteria

- [ ] `saveDemoSongSelection` looks up song by `spotify_id`, sets `user_preferences.demo_song_id`, returns success
- [ ] `saveDemoSongSelection` throws `OnboardingError` with correct tags on song-not-found and update-failure
- [ ] `getDemoSongShowcase` reads from `user_preferences.demo_song_id` — no reference to `env.DEMO_SONG_ID`
- [ ] `getDemoSongShowcase` response includes `spotifyTrackId` on `DemoSongData.song`
- [ ] `getDemoSongMatches` reads from `user_preferences.demo_song_id`
- [ ] No-playlists path: `getDemoSongMatches` returns `{ status: "ready", matches: [...], isDemo: true }` from demo match data, no polling
- [ ] Real-playlists path: returns `{ status: "ready", matches: [...], isDemo: false }`
- [ ] `DEMO_SONG_ID` fully removed from `src/env.ts`
- [ ] No references to `env.DEMO_SONG_ID` remain in codebase
- [ ] `saveDemoSongSelection` stub exists in mock file
- [ ] `bun run test` passes
- [ ] TypeScript compiles cleanly

## Notes on risks or ambiguity

- **`getOrCreatePreferences` return shape:** Verify it already returns `demo_song_id` after PDS-01's type regeneration. If the preferences query selects specific columns, the select list may need updating.
- **No-playlists detection in `getDemoSongMatches`:** The plan says "check if the user has any target playlists" — verify how this is currently determined (DB query? passed in? check existing code path).
- **`DemoSongData.song` type:** Adding `spotifyTrackId` may require updating the type definition and any existing callers that spread/destructure `song`. Check `SongShowcaseStep.tsx` for impact.
- **`DemoMatchResult` type change:** Adding `isDemo` to the `"ready"` variant will break `MatchShowcaseStep.tsx` (which currently uses `isCanned`). That's expected — PDS-03 fixes the consumer. Ensure the type is correct here; the UI story handles the rename on the component side.
