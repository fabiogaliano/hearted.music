## 1. Relocate shared DTOs

- [x] 1.1 Create `src/lib/workflows/spotify-sync/types.ts` with `SpotifyTrackArtistDTO`, `SpotifyTrackDTO`, `SpotifyPlaylistDTO`, `LikedSongsSyncResult`
- [x] 1.2 Update imports in `src/routes/api/extension/sync.tsx`
- [x] 1.3 Update imports in `src/lib/workflows/spotify-sync/playlist-sync.ts`
- [x] 1.4 Update imports in `src/lib/workflows/spotify-sync/sync-helpers.ts`
- [x] 1.5 Update imports in `src/lib/integrations/spotify/mappers.ts`
- [x] 1.6 Update imports in `src/test/fixtures.ts`, remove `SimplifiedPlaylist` SDK import

## 2. Refactor PlaylistSyncService to plain functions

- [x] 2.1 Convert `PlaylistSyncService` class to exported `syncPlaylists()` and `syncPlaylistTracksFromData()` functions
- [x] 2.2 Delete dead methods: `syncPlaylistTracks`, `createPlaylist`, `updatePlaylist`
- [x] 2.3 Remove `SpotifyService` constructor dependency
- [x] 2.4 Make `cachedPlaylists` a required parameter (remove dead `else` branch)
- [x] 2.5 Remove `SpotifyError` from `PlaylistSyncFailedError` union

## 3. Update extension sync route

- [x] 3.1 Replace `new PlaylistSyncService(null as unknown as SpotifyService)` with direct `syncPlaylists()` call
- [x] 3.2 Replace second `PlaylistSyncService` instance with direct `syncPlaylistTracksFromData()` call
- [x] 3.3 Remove `SpotifyService` import

## 4. Clean sync-helpers

- [x] 4.1 Delete `fetchLikedSongs()` (only caller was dead `SyncOrchestrator`)
- [x] 4.2 Remove `SpotifyService` and `SpotifyError` imports
- [x] 4.3 Update `SyncOperationError` union to `DbError | SyncFailedError`
- [x] 4.4 Update module comment (remove stale "extracted from SyncOrchestrator" reference)

## 5. Delete dead files

- [x] 5.1 `src/lib/integrations/spotify/service.ts`
- [x] 5.2 `src/lib/integrations/spotify/service.test.ts`
- [x] 5.3 `src/lib/integrations/spotify/pagination.ts`
- [x] 5.4 `src/lib/integrations/spotify/request.ts`
- [x] 5.5 `src/lib/integrations/spotify/request.test.ts`
- [x] 5.6 `src/lib/integrations/spotify/app-auth.ts`
- [x] 5.7 `src/lib/shared/utils/result-wrappers/spotify.ts`
- [x] 5.8 `src/lib/workflows/spotify-sync/orchestrator.ts`

## 6. Delete artist image routes

- [x] 6.1 Delete `src/routes/api/artist-images-for-tracks.tsx`
- [x] 6.2 Remove `appFetch` import, `ArtistsSchema`, `ArtistImageByIdSchema`, `ArtistImageResult`, `getArtistImageById` from `src/lib/server/liked-songs.functions.ts`
- [x] 6.3 Remove unused `artistImage` query key from `src/features/liked-songs/queries.ts`
- [x] 6.4 Regenerate route tree (`npx @tanstack/router-cli generate`)

## 7. Clean remaining files

- [x] 7.1 Strip `mappers.ts` to only `dedupeTracksBySpotifyId` (delete 6 unused mapper functions)
- [x] 7.2 Remove `SpotifyApiPlaylist` type and `toSpotifyApiPlaylist()` from `src/test/fixtures.ts`
- [x] 7.3 Remove `SpotifyError` from `OnboardingErrorCause` in `src/lib/shared/errors/domain/onboarding.ts`

## 8. Remove SDK and env vars

- [x] 8.1 Remove `@fostertheweb/spotify-web-sdk` from `package.json`
- [x] 8.2 Remove `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from `src/env.ts`
- [x] 8.3 Run `bun install` to update lockfile

## 9. Database migration

- [x] 9.1 Create migration to drop `app_token` table (`supabase migration new`, `migration up`)
- [x] 9.2 Create migration to add audio features to `get_liked_songs_page` RPC (`LEFT JOIN song_audio_feature`)
- [x] 9.3 Regenerate database types (`bun run gen:types`)

## 10. Delete backfill scripts

- [x] 10.1 Delete `scripts/backfills/backfill-artist-ids.ts`
- [x] 10.2 Delete `scripts/backfills/backfill-popularity-isrc.ts`

## 11. Move dedupe utility and delete spotify directory

- [x] 11.1 Create `src/lib/workflows/spotify-sync/dedupe.ts` with `dedupeTracksBySpotifyId`
- [x] 11.2 Update import in `playlist-sync.ts`
- [x] 11.3 Delete `src/lib/integrations/spotify/mappers.ts` and `src/lib/integrations/spotify/` directory

## 12. Unify filter types

- [x] 12.1 Make `FilterOption` an alias for `LikedSongFilter` in `src/features/liked-songs/queries.ts`
- [x] 12.2 Update Zod schema in `src/lib/server/liked-songs.functions.ts` to validate `LikedSongFilter` values
- [x] 12.3 Remove dead `LikedSongsPageParams` interface

## 13. Verify

- [x] 13.1 TypeScript type-check passes (0 new errors)
- [x] 13.2 All 245 tests pass (29 test files)
- [x] 13.3 Route tree regenerated successfully
