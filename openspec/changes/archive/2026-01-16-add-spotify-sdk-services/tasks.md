# Tasks: Add Spotify SDK Services

## 1. Dependencies & Structure
- [x] 1.1 Add `@fostertheweb/spotify-web-sdk` dependency (bun add)
- [x] 1.2 Create `src/lib/services/spotify/`
- [x] 1.3 Move `src/lib/spotify/client.ts` -> `src/lib/services/spotify/client.ts`
- [x] 1.4 Update imports in auth routes and other callers
- [x] 1.5 Move any other service modules into `src/lib/services/` (if present)

## 2. SDK Factory + Service
- [x] 2.1 Create `src/lib/services/spotify/sdk.ts` with `createSpotifyApi(accessToken)`
- [x] 2.2 Add `SpotifyService` (retry + pagination helpers, port v0 methods)
- [x] 2.3 Add `getSpotifyService(accountId)` that uses the token client and SDK

## 3. Token Refresh Coordination
- [x] 3.1 Add per-account refresh promise map in the token client
- [x] 3.2 Ensure refresh updates Supabase and reuses in-flight refresh

## 4. Validation
- [x] 4.1 Verify TypeScript + Biome
- [x] 4.2 Run `openspec validate add-spotify-sdk-services --strict --no-interactive`
