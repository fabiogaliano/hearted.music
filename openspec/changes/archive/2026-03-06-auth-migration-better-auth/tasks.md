## 0. Runtime Validation (Phase 0 — do first)

- [x] 0.1 Install `better-auth`, `drizzle-orm`, `postgres` (`bun add better-auth drizzle-orm postgres`)
- [x] 0.2 Create minimal Better Auth config with Drizzle + postgres.js adapter pointing at Supabase Postgres (`prepare: false` for transaction pooler compatibility)
- [x] 0.3 Create Drizzle schema file (`src/lib/auth-schema.ts`) mapping Better Auth models to table definitions
- [x] 0.4 Verify auth endpoints respond: `/api/auth/get-session`, `/api/auth/sign-in/social`
- [x] ~~0.5 CF Workers deployment~~ Deferred — postgres.js works on CF Workers via `cloudflare:sockets` + Supabase transaction pooler

## 1. Better Auth Setup

- [x] 1.1 Add Better Auth env vars to `.env` and `src/env.ts`: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL` (Supabase Postgres connection string), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- [x] 1.2 Create Better Auth server config at `src/lib/auth.ts`: `betterAuth()` with Drizzle adapter (`drizzleAdapter(db, { provider: 'pg', schema })`), Google social provider, `tanstackStartCookies` plugin, `oauth_account` modelName to avoid table conflict
- [x] 1.3 Create auth client at `src/lib/auth-client.ts`: `createAuthClient()` with `signIn`, `signOut`, `useSession` exports

## 2. Database Migration (via supabase CLI)

- [x] 2.1 Generate Better Auth migration SQL: `bunx @better-auth/cli generate` for tables (`user`, `session`, `oauth_account`, `verification`)
- [x] 2.2 Create Supabase migration via CLI: `supabase migration new add_better_auth_tables` — include Better Auth tables, add `better_auth_user_id UUID REFERENCES "user"(id)` column to `account` table, make `spotify_id` nullable (`ALTER TABLE account ALTER COLUMN spotify_id DROP NOT NULL`)
- [x] 2.3 Enable RLS on Better Auth tables with no permissive policies (deny all for `anon`/`authenticated` roles — `postgres` and `service_role` bypass RLS via `BYPASSRLS` attribute)
- [x] 2.4 Apply migration: `supabase db push` (or `supabase db reset` for clean state) — verify all FK constraints pass

## 3. Auth Route Handler

- [x] 3.1 Create catch-all route at `src/routes/api/auth/$.ts` with GET and POST handlers forwarding to `auth.handler(request)`
- [x] 3.2 Verify Better Auth endpoints respond: `/api/auth/get-session`, `/api/auth/sign-in/social`, `/api/auth/callback/google`

## 4. Session Helpers & Route Guards

- [x] 4.1 Create `src/lib/auth.server.ts` with `getAuthSession()` (returns session or null) and `requireAuthSession()` (returns session or throws redirect) using `auth.api.getSession({ headers: getRequestHeaders() })`
- [x] 4.2 Add account creation hook in `src/lib/auth.ts`: after first social login, create `account` record with `better_auth_user_id`, null `spotify_id`, copy email/display_name from Better Auth user
- [x] 4.3 Update `src/lib/data/accounts.ts`: add `getAccountByBetterAuthUserId(userId)` function, update `UpsertAccountData` type to accept `better_auth_user_id` and nullable `spotify_id`
- [x] 4.4 Update `src/routes/_authenticated/route.tsx`: replace `requireAuth()` import with `requireAuthSession()` from `auth.server.ts`, map Better Auth user to existing `{ session, account }` context shape

## 5. Update All Session Call Sites

- [x] 5.1 Update `src/lib/server/onboarding.functions.ts`: replace all `requireSession(request)` calls with session from `requireAuthSession()` or `getAuthSession()`
- [x] 5.2 Update `src/lib/server/dashboard.functions.ts`: replace `requireSession()` calls
- [x] 5.3 Update `src/lib/server/liked-songs.functions.ts`: replace `requireSession()` calls
- [x] 5.4 Update `src/routes/api/extension/sync.tsx`: replace `getSession(request)` with `getAuthSession()` (bearer token validation deferred to Phase 9)
- [x] 5.5 Update `src/routes/api/extension/status.tsx`: replace `getSession(request)` with `getAuthSession()` (bearer token validation deferred to Phase 9)
- [x] 5.6 Update `src/routes/api/jobs/$id/progress.tsx`: replace `getSession(request)` with `getAuthSession()` pattern
- [x] 5.7 Audit remaining files referencing `getSession` or `requireSession` and update (26 files total per grep)

## 6. Login Page & Landing Page

- [x] 6.1 Create login page component with Google sign-in button using `authClient.signIn.social({ provider: "google" })`. Route: `src/routes/login.tsx`
- [x] 6.2 Update landing page CTA: change from Spotify OAuth redirect to social login page navigation
- [x] 6.3 Update logout route `src/routes/auth/logout.tsx`: replace custom cookie clearing with `authClient.signOut()` or server-side `auth.api.signOut()`

## 7. Delete Old Auth Code

- [x] 7.1 Delete `src/lib/auth/cookies.ts` (custom cookie management)
- [x] 7.2 Delete `src/lib/auth/session.ts` (custom session management)
- [x] 7.3 Delete `src/lib/auth/oauth.ts` (PKCE helpers)
- [x] 7.4 Delete `src/lib/auth/guards.ts` (old route guard, replaced by `auth.server.ts`)
- [x] 7.5 Delete `src/routes/auth/spotify/index.tsx` (Spotify OAuth initiation)
- [x] 7.6 Delete `src/routes/auth/spotify/callback.tsx` (Spotify OAuth callback)
- [x] 7.7 Delete `src/lib/data/auth-tokens.ts` (Spotify token CRUD)
- [x] 7.8 Remove `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` from `src/env.ts`
- [x] 7.9 `@fostertheweb/spotify-web-sdk` still used by spotify integration — keep for now
- [x] 7.10 Drop `auth_token` table via migration: `supabase migration new drop_auth_token_table`

## 8. Onboarding Flow Rewire

- [x] 8.1 Create `InstallExtensionStep` component at `src/features/onboarding/components/InstallExtensionStep.tsx`: shows install prompt, Chrome Web Store link, detects extension via `chrome.runtime.sendMessage(EXTENSION_ID, { type: "PING" })`
- [x] 8.2 Add extension detection utility: `src/lib/extension/detect.ts` — wraps `chrome.runtime.sendMessage` with `externally_connectable`, returns boolean
- [x] 8.3 Update onboarding state machine: add `install-extension` step value to `ONBOARDING_STEPS` Zod enum in `src/lib/data/preferences.ts`
- [x] 8.4 Replace `ConnectingStep.tsx`: remove `getLibrarySummary()` call (which depends on `getSpotifyService()`), wire to extension sync trigger instead
- [x] 8.5 Update `src/lib/server/onboarding.functions.ts`: remove `getSpotifyService()` dependency from `getLibrarySummary()` and `executeSync()`, rewire to use extension-synced data from DB
- [x] 8.6 Update onboarding navigation flow in `src/features/onboarding/hooks/useOnboardingNavigation.ts` to include the new install-extension step

## 9. Extension Auth — Bearer Token Handoff

- [x] 9.1 Add `externally_connectable` to extension `manifest.json` with app origins (localhost + production)
- [x] 9.2 Add PING message handler in service worker (extension detection from web app)
- [x] 9.3 Add CONNECT message handler in service worker (receives + stores API token in `chrome.storage.local`)
- [x] 9.4 Replace `credentials: "include"` with `Authorization: Bearer <token>` header in `postToBackend()` (`extension/src/background/service-worker.ts`)
- [x] 9.5 Backend: create `api_token` table via `supabase migration new add_api_token_table` — columns: `id`, `account_id` (FK), `token_hash`, `created_at`, `last_used_at`
- [x] 9.6 Backend: create token generation endpoint (called during extension connection handoff) + validation middleware for extension routes
- [x] 9.7 Update `SyncPayloadSchema` in `src/routes/api/extension/sync.tsx` to accept optional `userProfile` field — link `spotify_id` to account if not already set
- [x] 9.8 Add GET_STATUS response to include account info so extension can display "Connected as..."

## 10. Wire SSE Progress into Extension Sync

- [x] 10.1 Update `/api/extension/sync` to create job records before processing (like `createSyncJob()` in `onboarding.functions.ts`)
- [x] 10.2 Wrap sync operations in `runPhase()` calls to emit SSE status/progress events
- [x] 10.3 Return job IDs in the sync response so the web app can subscribe to `/api/jobs/$id/progress`
- [x] 10.4 Alternative: split into two endpoints — skipped (single endpoint approach)
- [x] 10.5 Update `SyncingStep.tsx` to work with extension-triggered sync: subscribe to job IDs from extension sync response

## 11. Spotify API Cleanup

- [x] 11.1 Remove user-scoped Spotify service code: `getSpotifyService()` in `src/lib/integrations/spotify/index.ts`, token refresh logic in `src/lib/integrations/spotify/client.ts`
- [x] 11.2 Keep `src/lib/integrations/spotify/app-auth.ts` (Client Credentials for album art) — gracefully degrades when env vars missing
- [x] 11.3 Update `src/lib/capabilities/sync/orchestrator.ts`: remove Spotify service dependency, sync now reads from DB (populated by extension)
- [x] 11.4 Audit and remove any dead code referencing `getSpotifyClient`, `exchangeCodeForTokens`, `performTokenRefresh`, `refreshTokenWithCoordination`

## 12. Verification

- [x] 12.1 Run `bun run typecheck` — zero NEW type errors (7 pre-existing view column errors in liked-songs.functions.ts remain)
- [x] 12.2 Run `bun run test` — all existing tests pass (updated SyncingStep test mocks for new polling pattern)
- [x] 12.3 Manual test: Google login → session created → redirect to onboarding → extension install step shown
- [x] 12.4 Manual test: Extension connects → bearer token handoff → sync triggers → data appears in DB → onboarding proceeds to flag-playlists
- [ ] 12.5 Manual test: Logout → session destroyed → redirect to landing page
- [x] 12.6 Manual test: Extension `Authorization: Bearer` sends token → `/api/extension/sync` returns 200 with job IDs → SSE progress streams
- [ ] 12.7 Manual test: Revoke token from web app → extension gets 401 → prompts reconnection
