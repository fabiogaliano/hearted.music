## Why

Spotify deprecated its official public API. The Chrome extension's Pathfinder API now handles all Spotify data fetching — liked songs, playlists, playlist tracks, artist images, and mutations. The `@fostertheweb/spotify-web-sdk` package, `SpotifyService` class, Client Credentials auth flow, and supporting infrastructure are dead code that was never instantiated in production (the extension sync endpoint passed `null as unknown as SpotifyService`). Keeping ~1200 lines of dead code increases maintenance burden and confuses the dependency graph.

## What Changes

- Remove `@fostertheweb/spotify-web-sdk` package dependency
- Delete `SpotifyService` class, `SyncOrchestrator` class, and all supporting files (pagination, request retry, app-auth, SDK result wrappers)
- Relocate `SpotifyTrackDTO` and `SpotifyPlaylistDTO` to `src/lib/workflows/spotify-sync/types.ts` (still needed as the extension sync payload shape)
- Convert `PlaylistSyncService` class to plain exported functions (`syncPlaylists`, `syncPlaylistTracksFromData`)
- Delete dead artist image routes (`/api/artist-images-for-tracks`, `getArtistImageById` server function) — extension sync already populates artist images via Pathfinder
- Drop orphaned `app_token` database table (was Client Credentials token cache)
- Remove `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` environment variables
- Delete completed one-shot backfill scripts that depended on `appFetch`
- Move `dedupeTracksBySpotifyId` from `integrations/spotify/mappers.ts` to `workflows/spotify-sync/dedupe.ts`, delete empty `integrations/spotify/` directory
- Fix pre-existing type errors in `liked-songs.functions.ts`: add audio features JOIN to `get_liked_songs_page` RPC, unify `FilterOption` to use `LikedSongFilter` as single source of truth

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `extension-data-pipeline`: Extension is now the sole source of all Spotify data — no fallback to official API
- `access-spotify-api`: Capability effectively retired; all Spotify access is via extension Pathfinder API

## Affected specs

- Retired: `access-spotify-api` (Client Credentials flow, OAuth SDK)
- Modified: `extension-data-pipeline` (now sole data source)

## Impact

- 10 files deleted, 6 files refactored, ~1200 lines of dead code removed
- `src/lib/integrations/spotify/` directory entirely removed
- `app_token` database table dropped via migration
- No external API contract or user-visible behavior changes — the official API was not called in production
- Audio features (BPM, energy, valence) now flow to the liked songs detail panel (previously silently broken)
