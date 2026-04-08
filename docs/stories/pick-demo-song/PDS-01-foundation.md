# PDS-01: Foundation — migration, seed script, demo match data extraction

## Goal

Lay the data layer groundwork: add `demo_song_id` column, create the seed script for landing songs, extract demo match data from `Landing.tsx` into a shared module, and regenerate DB types.

## Depends on / Blocks

- **Depends on:** nothing
- **Blocks:** PDS-02 (server functions need the column and demo match data module)

## Scope

### In scope

1. **Migration** `supabase/migrations/20260407000000_add_demo_song_id.sql`
   - `ALTER TABLE user_preferences ADD COLUMN demo_song_id UUID REFERENCES song(id) ON DELETE SET NULL;`
   - Nullable column, no default

2. **Seed script** `scripts/seed-landing-songs.ts`
   - Reads all `public/landing-songs/*.json` detail files
   - Upserts into `song` table by `spotify_id`
   - Maps: `name`, `artists` (array), `album_name`, `image_url`, `genres`, `spotify_id`
   - Uses `createAdminSupabaseClient`
   - Idempotent (upsert on `spotify_id`)
   - No `song_analysis` seeding

3. **Demo match data module** `src/lib/data/demo-matches.ts`
   - Extract from `Landing.tsx`:
     - `DEMO_PLAYLISTS` (renamed from `PLAYLISTS`) typed as `DemoPlaylist[]`
     - `DEMO_SONG_MATCHES` (renamed from `SONG_PLAYLIST_MATCHES`) typed per-song top-3 scores keyed by `spotifyTrackId`
     - `getDemoMatchesForSong(spotifyTrackId: string): DemoMatchPlaylist[]` — joins matches with playlists
   - Export types: `DemoPlaylist`, `DemoSongMatch`, `DemoMatchPlaylist`

4. **Update `Landing.tsx`** to import `DEMO_PLAYLISTS`, `DEMO_SONG_MATCHES`, and related types from `demo-matches.ts` instead of defining inline

5. **Regenerate `database.types.ts`** after migration

### Out of scope

- Server functions (PDS-02)
- UI components (PDS-03)
- Running seed script in CI/CD
- `song_analysis` seeding (analyses come from the existing pipeline)

## Likely touchpoints

| Area | Files |
|------|-------|
| Migration | `supabase/migrations/20260407000000_add_demo_song_id.sql` |
| Seed script | `scripts/seed-landing-songs.ts` |
| Demo match data | `src/lib/data/demo-matches.ts` (new) |
| Landing page | `src/features/landing/Landing.tsx` (extract data, import from new module) |
| Generated types | `src/lib/data/database.types.ts` |

## Constraints and decisions to honor

- Seed script scope is `song` table only — no `song_analysis` (plan: "Resolved decisions")
- `demo_song_id` is nullable, only populated once user picks (plan: "Schema change")
- `ON DELETE SET NULL` for the FK (plan: "Schema change")
- Demo match data is static, no DB rows — shared by landing page and server functions (plan: "Demo match data")

## Acceptance criteria

- [ ] Migration applies cleanly; `user_preferences.demo_song_id` column exists, nullable UUID, FK to `song(id)`
- [ ] `bun run scripts/seed-landing-songs.ts` upserts landing songs into `song` table without errors
- [ ] Running seed script twice produces no duplicates
- [ ] `src/lib/data/demo-matches.ts` exports `DEMO_PLAYLISTS`, `DEMO_SONG_MATCHES`, `getDemoMatchesForSong`
- [ ] `getDemoMatchesForSong` returns correct `DemoMatchPlaylist[]` for a known track ID
- [ ] `Landing.tsx` imports from `demo-matches.ts` — no inline playlist/match data remains
- [ ] Landing page renders identically after extraction (visual spot-check)
- [ ] `database.types.ts` regenerated with `demo_song_id` field
- [ ] `bun run test` passes
- [ ] TypeScript compiles cleanly

## Notes on risks or ambiguity

- **Seed script field mapping:** The plan specifies fields (`name`, `artists`, `album_name`, `image_url`, `genres`, `spotify_id`) — verify these match the `song` table columns exactly. Check the actual `LandingSongDetail` type for field names.
- **Migration timestamp:** Use `20260407000000` as specified in plan. Verify it sorts after the latest existing migration (`20260406000000_billing_admin_task.sql`).
- **`getDemoMatchesForSong` return type:** Must match `DemoMatchPlaylist[]` — same shape as the server response from `getDemoSongMatches`. Verify against existing `DemoMatchPlaylist` type in `onboarding.functions.ts`.
