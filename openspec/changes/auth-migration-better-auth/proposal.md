## Why

Spotify is revoking API access in 5 days. The app currently uses Spotify OAuth as both the identity provider (login) and the data access mechanism (API tokens for liked songs, playlists). Both must be replaced: auth moves to Better Auth with social providers, and data ingestion moves to the Chrome extension's Pathfinder pipeline which already works independently of the Spotify developer API.

## What Changes

- **BREAKING** Replace Spotify OAuth PKCE flow with Better Auth (Google/Apple social login)
- **BREAKING** Replace custom session management (cookie with account UUID) with Better Auth's session system
- **BREAKING** Decouple identity from `spotify_id` — Better Auth's `user` table becomes the identity source, `spotify_id` becomes linked metadata populated on first extension sync
- **BREAKING** Remove `auth_token` table (Spotify OAuth tokens for login) — no longer needed
- **BREAKING** Replace onboarding "Connecting to Spotify" step with extension-driven sync flow
- **BREAKING** `getSpotifyService(accountId)` no longer used for initial sync — extension Pathfinder pipeline becomes the primary data source
- Keep `app_token` table for Client Credentials flow (album art, artist metadata) until Spotify fully cuts access
- Keep existing SSE job progress infrastructure unchanged — extension sync endpoint will be updated to create job records and emit SSE events (currently missing), using the same `runPhase()`/`emitItem()` pattern as the orchestrator
- Extension auth switches from `credentials: "include"` (session cookie) to bearer token via `externally_connectable` — app generates API token, sends to extension via `chrome.runtime.sendMessage`, extension uses `Authorization: Bearer` header for all backend requests

## Capabilities

### New Capabilities

- `extension-data-pipeline`: Formalizes the Chrome extension as the primary data ingestion path. Covers: extension installation detection, sync triggering from the web app, extension-to-backend authentication (bearer token via `externally_connectable`), and the data flow from Pathfinder API through `/api/extension/sync` to the database. Includes SSE job progress integration for real-time sync progress in the web app UI.

### Modified Capabilities

- `auth`: **BREAKING** — Spotify OAuth replaced with Better Auth. Session management, route guards, login/logout flows, and account identity model all change. Custom cookie auth (`session.ts`, `cookies.ts`, `guards.ts`) replaced by Better Auth's built-in session handling with TanStack Start integration.
- `onboarding`: **BREAKING** — "Connecting to Spotify" step (`ConnectingStep`) and `getLibrarySummary()` can no longer call `getSpotifyService()`. Sync flow must be rewired to depend on extension data. State machine changes: `LOGIN (oauth)` step removed, replaced with social login + extension install prompt.
- `access-spotify-api`: **BREAKING** — SDK-backed service loses its OAuth token source for user-scoped operations. User-scoped Spotify data (liked songs, playlists, playlist tracks) now comes exclusively from the extension Pathfinder pipeline. App-level Client Credentials (`app_token`) may remain for non-user-scoped lookups (album art, artist info) if Spotify doesn't revoke that too.

## Impact

**Database**: New Better Auth tables (`user`, `session`, `account`, `verification`). Existing `account` table gets `better_auth_user_id` column or is replaced. `auth_token` table removed. `spotify_id` becomes nullable metadata, not identity key.

**Auth routes**: Delete `src/routes/auth/spotify/` (index + callback). Add Better Auth handler at `src/routes/api/auth/$.ts`. Update `src/routes/auth/logout.tsx`.

**Session layer**: Delete `src/lib/auth/oauth.ts`, `cookies.ts`, `session.ts`. Update `guards.ts` to use Better Auth session. All `getSession(request)` and `requireSession(request)` call sites updated.

**Onboarding**: `ConnectingStep.tsx` rewired — no longer calls `getLibrarySummary()` which depends on `getSpotifyService()`. New flow: detect extension → trigger sync → show progress.

**Server functions**: All functions using `requireSession()` updated to use Better Auth session. `onboarding.functions.ts` (`getLibrarySummary`, `executeSync`) heavily modified.

**Extension**: Auth mechanism changes from `credentials: "include"` (session cookies) to bearer token via `externally_connectable`. Extension receives API token from web app during connection handoff, stores in `chrome.storage.local`, sends as `Authorization: Bearer` header. `postToBackend()` updated accordingly.

**Dependencies**: Add `better-auth`, `drizzle-orm`, `@neondatabase/serverless` packages. Remove `@fostertheweb/spotify-web-sdk` if all user-scoped API access moves to extension. Keep `@supabase/supabase-js` (still used for DB via service_role).

**RLS**: No changes — current "deny all + service_role bypass" strategy is auth-provider-agnostic.

**Constraints**: All Supabase database schema changes MUST go through `supabase` CLI (`supabase migration new`, `supabase db push`). Never use MCP/dashboard tools for DDL operations.
