# Tasks: Add Spotify Authentication

## 0. Prerequisites (Manual)

- [ ] 0.1 Create Spotify Developer App at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
- [ ] 0.2 Add redirect URI: `http://127.0.0.1:3000/auth/callback`
- [ ] 0.3 Copy Client ID to `.env`
- [ ] 0.4 Copy Client Secret to `.env` (for server-side token exchange)
- [ ] 0.5 Generate SESSION_SECRET (32+ random chars) for `.env`
- [ ] 0.6 Copy Supabase service role key to `.env` (server-only)

## 1. Database Schema

- [x] 1.1 Create migration `001_create_account.sql`
  - `account` table: id, spotify_id, email, display_name, created_at, updated_at
  - UNIQUE constraint on spotify_id
  - Index on spotify_id for lookup
  - Enable RLS (service_role bypasses)
- [x] 1.2 Create migration `002_create_auth_token.sql`
  - `auth_token` table: id, account_id, access_token, refresh_token, token_expires_at, created_at, updated_at
  - UNIQUE constraint on account_id (one token set per account)
  - FK to account with ON DELETE CASCADE
  - Index on account_id for token lookup
  - Enable RLS (service_role bypasses)
- [ ] 1.3 Apply migrations locally: `supabase db reset`
- [ ] 1.4 Generate TypeScript types: `supabase gen types typescript --local`
- [x] 1.5 Update `src/lib/data/database.types.ts`

## 2. Environment Configuration

- [x] 2.1 Add Spotify env vars to `src/env.ts`
  - `SPOTIFY_CLIENT_ID`
  - `SPOTIFY_CLIENT_SECRET`
  - `SPOTIFY_REDIRECT_URI`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SESSION_SECRET`
- [x] 2.2 Update `.env.example` with new variables
- [x] 2.3 Update `.env.local` with local values

## 3. Auth Utilities

- [x] 3.1 Create `src/lib/auth/oauth.ts` — PKCE helpers
  - `generateCodeVerifier()`
  - `generateCodeChallenge(verifier)`
  - `generateState()`
- [x] 3.2 Create `src/lib/auth/session.ts` — Cookie management
  - `getSession(request)`
  - `requireSession(request)`
- [x] 3.3 Create `src/lib/auth/cookies.ts` — Cookie helpers
  - `setOAuthCookies(state, codeVerifier)`
  - `getOAuthCookies(request)`
  - `clearOAuthCookies()`
  - `setSessionCookie(accountId)`
  - `getSessionCookie(request)`
  - `clearSessionCookie()`
- [ ] 3.4 Create `src/lib/auth/middleware.ts` — Route guards (deferred - using session.ts)

## 4. OAuth Routes

- [x] 4.1 Create `src/routes/auth/spotify.tsx` — Initiate login
  - Generate PKCE codes
  - Set OAuth cookies
  - Redirect to Spotify /authorize
- [x] 4.2 Create `src/routes/auth/callback.tsx` — Handle redirect
  - Verify state
  - Exchange code for tokens
  - Create/update account in DB
  - Create session
  - Clear OAuth cookies
  - Redirect to home/dashboard
- [x] 4.3 Create `src/routes/auth/logout.tsx` — Clear session (POST)
  - Destroy session cookie
  - Delete tokens from DB
  - Redirect to home

## 5. Spotify API Client

- [x] 5.1 Create `src/lib/spotify/client.ts`
  - `getSpotifyClient(accountId)` — Returns client with valid token
  - Auto-refresh if token expired
  - Update DB with new tokens after refresh
  - `exchangeCodeForTokens(code, codeVerifier)` — Token exchange
  - `fetchSpotifyUser(accessToken)` — Get user profile
- [ ] 5.2 Create `src/lib/spotify/api.ts` — API helpers (deferred - using client.ts)

## 6. Data Modules

- [x] 6.1 Update `src/lib/data/client.ts` with service-role client
  - `createServiceSupabaseClient()` (server-only, uses `SUPABASE_SERVICE_ROLE_KEY`)
- [x] 6.2 Create `src/lib/data/accounts.ts`
  - `getAccountById(id)`
  - `getAccountBySpotifyId(spotifyId)`
  - `upsertAccount(data)` — create or update account identity
- [x] 6.3 Create `src/lib/data/auth-tokens.ts`
  - `getTokenByAccountId(accountId)`
  - `upsertToken(accountId, tokens)` — create or update tokens
  - `deleteToken(accountId)` — for logout/revocation
  - `isTokenExpired(token)` — utility to check expiry

## 7. Testing & Validation

- [x] 7.1 Ensure local Supabase is running (if testing locally)
- [x] 7.2 Ensure dev server is running (assume already started)
- [x] 7.3 Test login flow:
  - Visit `http://127.0.0.1:3000/auth/spotify`
  - Approve Spotify permissions
  - Verify redirect to callback
  - Verify account created in DB
  - Verify session cookie set
- [ ] 7.4 Test logout flow
- [ ] 7.5 Test token refresh (wait 1 hour or manually expire)
- [x] 7.6 Verify TypeScript compiles
- [x] 7.7 Verify Biome passes

## 8. Push to Cloud (Optional)

- [ ] 8.1 Push migration to cloud: `supabase db push`
- [ ] 8.2 Add redirect URI for production domain
- [ ] 8.3 Test login on cloud

---

## Notes

- Start with local testing only
- Cloud deployment can wait until login is working locally
- Token refresh testing may require waiting or manual DB update
- Manual prerequisites (Section 0) must be completed by user before testing
- Migrations created via `supabase migration new` for proper CLI tracking
