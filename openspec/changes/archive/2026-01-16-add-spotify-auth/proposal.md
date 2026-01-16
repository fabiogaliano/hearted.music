# Change: Add Spotify Authentication

## Why

The app needs to authenticate users via Spotify to access their liked songs and playlists. This is the foundational authentication layer that enables all user-specific features.

This is **Phase 1a** of the migration-v2 roadmap — implementing OAuth before the full schema so we can test the login flow end-to-end.

## Approach

**PKCE Authorization Code Flow** — Recommended by Spotify for web apps where client secrets can't be safely stored in the browser. No client secret is sent to the frontend.

Key decisions:
- Store tokens server-side in Supabase `auth_token` table (separate from account identity)
- Use service-role Supabase client for auth writes (RLS bypass)
- Use HTTP-only cookies for session management
- Implement token refresh automatically when expired
- Support both local and cloud Supabase

## What Changes

- Add `account` table migration (minimal schema for OAuth)
- Add `auth_token` table migration for token storage
- Add Spotify OAuth environment variables
- Add service-role Supabase client helper + auth data modules
- Create `/auth/spotify` route (initiate login)
- Create `/auth/callback` route (handle Spotify redirect)
- Create `/auth/logout` route
- Add session + OAuth cookie utilities
- Create Spotify API client with auto-refresh

## Impact

- **Affected specs**: NEW `auth` capability
- **Affected code**:
  - `supabase/migrations/` — account + auth_token tables
  - `src/env.ts` — Spotify credentials + service role key
  - `src/routes/auth/` — OAuth routes
  - `src/lib/auth/` — Session + OAuth utilities
  - `src/lib/data/` — Supabase client + account/auth_token modules
  - `src/lib/spotify/` — API client

## Dependencies

- Phase 0: Supabase Foundation ✅ (completed)

## Blocked By

- Spotify Developer App must be created at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
- Redirect URI must be registered: `http://127.0.0.1:3000/auth/callback`

## Enables

- Fetching user's liked songs
- Fetching user's playlists
- All personalized features
- Onboarding flow completion

## Scopes Required

```
user-read-private        # User profile
user-read-email          # User email
user-library-read        # Liked songs
playlist-read-private    # User's playlists
playlist-modify-public   # Create/modify playlists
playlist-modify-private  # Create/modify private playlists
```

## Notes

- Access tokens expire in 1 hour — must handle refresh
- Refresh tokens should be stored securely (server-side only)
- PKCE eliminates need for client_secret on frontend
- Free tier Supabase supports this use case fully
