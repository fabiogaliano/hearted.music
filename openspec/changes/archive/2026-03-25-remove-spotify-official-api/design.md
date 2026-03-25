## Context

Spotify announced deprecation of its public API. The hearted. Chrome extension replaced all Spotify data access with Spotify's internal Pathfinder GraphQL API. The official SDK (`@fostertheweb/spotify-web-sdk`), `SpotifyService` wrapper class, and Client Credentials auth flow became dead code. The extension sync endpoint (`/api/extension/sync`) was the only production consumer, passing `null as unknown as SpotifyService` to `PlaylistSyncService`.

## Goals

1. Remove `@fostertheweb/spotify-web-sdk` dependency and all dead code paths
2. Relocate shared DTOs (`SpotifyTrackDTO`, `SpotifyPlaylistDTO`) to their actual domain (sync workflow)
3. Simplify `PlaylistSyncService` from a stateful class to plain functions
4. Drop orphaned `app_token` database table
5. Fix pre-existing type errors exposed during cleanup

## Non-Goals

- Modifying the extension Pathfinder implementation
- Changing the sync endpoint behavior
- Migrating backfill scripts (deleted instead — already ran)

## Decisions

### 1. Relocate DTOs to `workflows/spotify-sync/types.ts`

`SpotifyTrackDTO` and `SpotifyPlaylistDTO` define the shape of data the extension sends. They belong in the sync workflow, not in a dead SDK wrapper.

**Alternative considered**: Inline types in `sync.tsx`. Rejected — types are shared across `sync.tsx`, `playlist-sync.ts`, `sync-helpers.ts`, and `fixtures.ts`.

### 2. Convert `PlaylistSyncService` to plain functions

After removing `SpotifyService` from the constructor, the class had no state. Two live methods (`syncPlaylists`, `syncPlaylistTracksFromData`) became standalone functions.

**Alternative considered**: Keep as stateless class. Rejected — unnecessary ceremony for the single consumer (`sync.tsx`).

### 3. Delete artist image routes rather than refactor

`/api/artist-images-for-tracks` and `getArtistImageById` had zero callers in feature code. Artist images are populated by extension sync via `collectArtistUpsertData`. The `SonicNumbers` UI component reads `artist_image_url` from the DB join.

### 4. Drop `app_token` table via migration

Only `app-auth.ts` read/wrote this table (Client Credentials token cache). With `app-auth.ts` deleted, the table is orphaned.

### 5. Fix audio features RPC

The `get_liked_songs_page` RPC was missing a `LEFT JOIN song_audio_feature`. Added it so `audio_tempo`, `audio_energy`, `audio_valence` flow to the `SonicNumbers` component in `PanelHero`.

### 6. Unify filter types

`FilterOption` (UI) and `LikedSongFilter` (domain) had diverged. Made `FilterOption` an alias for `LikedSongFilter` — single source of truth from the domain layer.

## Risks / Trade-offs

- **Backfill scripts broken**: `backfill-artist-ids.ts` and `backfill-popularity-isrc.ts` imported `appFetch` from deleted `app-auth.ts`. Mitigated: scripts were one-shot, already ran, deleted.
- **`SpotifyError` types kept**: Still referenced in sync error unions. Low risk — no harm keeping them as valid error domain concepts.
- **openspec archived changes reference SDK**: Left as-is — historical records.

## Migration Plan

1. Create `src/lib/workflows/spotify-sync/types.ts` with relocated DTOs
2. Update all imports to new type locations
3. Refactor `PlaylistSyncService` → plain functions
4. Update extension sync route to use direct function calls
5. Remove dead `fetchLikedSongs` from sync-helpers
6. Delete 8 dead files (service, tests, pagination, request, app-auth, result-wrappers, orchestrator)
7. Delete artist image routes, clean `liked-songs.functions.ts`
8. Clean mappers (keep only `dedupeTracksBySpotifyId`), clean test fixtures, clean error types
9. Remove SDK from `package.json`, remove env vars, `bun install`
10. Create migration to drop `app_token` table, `supabase migration up`
11. Move `dedupeTracksBySpotifyId` to `workflows/spotify-sync/dedupe.ts`, delete `integrations/spotify/`
12. Fix `get_liked_songs_page` RPC — add audio features JOIN
13. Unify `FilterOption` → `LikedSongFilter`
14. Verify: `tsc --noEmit`, `bun run test`, route tree regeneration
