# Change: Add Spotify SDK Services

## Why

The app needs a Spotify service layer that matches v0 patterns (SDK usage, retry, pagination) while keeping v1 token storage in Supabase. We also want a consistent service location under `src/lib/services` for current and future service modules.

## What Changes

- Add `@fostertheweb/spotify-web-sdk` to v1 dependencies
- Move existing Spotify token client into `src/lib/services/spotify/`
- Add a Spotify SDK factory that accepts access tokens from Supabase
- Add a `SpotifyService` with retry + pagination helpers
- Add refresh coordination to avoid parallel token refreshes per account
- Align any existing service modules with the `src/lib/services/` location

## Impact

- **Affected specs**: NEW `access-spotify-api` capability
- **Affected code**:
  - `src/lib/spotify/*` -> `src/lib/services/spotify/*`
  - `src/routes/auth/*` (import updates for token exchange)
  - `src/lib/data/auth-tokens.ts` (refresh coordination usage)
  - `package.json` (new dependency)

## Dependencies

- Requires the existing Spotify OAuth flow (already implemented)

## Notes

- Token exchange/refresh stays in the raw fetch client
- The SDK is used only for Spotify API calls after a valid access token is available
