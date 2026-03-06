## Context

The app currently uses Spotify OAuth (PKCE) as its sole authentication provider. Spotify is revoking API access in 5 days. The auth system is custom-built: HTTP-only cookies store an account UUID, with Spotify OAuth tokens stored server-side in `auth_token`. The Chrome extension already has a working data pipeline via Spotify's internal Pathfinder API that bypasses the official developer API entirely.

**Current auth surface area:**
- `src/lib/auth/` — `cookies.ts`, `session.ts`, `guards.ts`, `oauth.ts` (custom session management)
- `src/routes/auth/spotify/` — OAuth initiation + callback routes
- `src/routes/auth/logout.tsx` — logout handler
- `src/routes/_authenticated/route.tsx` — layout route guard using `requireAuth()`
- `src/lib/data/auth-tokens.ts` — Spotify token CRUD
- `src/lib/data/accounts.ts` — account CRUD keyed on `spotify_id`
- 26 files reference `accountId` / `session.accountId` across `src/lib/`

**FK dependency chain from `account` table:**
`playlist`, `liked_song`, `match_context`, `auth_token`, `user_preferences`, `item_status`, `job` — all reference `account(id) ON DELETE CASCADE`.

## Goals / Non-Goals

**Goals:**
- Replace Spotify OAuth with Better Auth (Google social login)
- Maintain cookie-based auth for the web app (Better Auth session cookies); extension uses bearer token via `externally_connectable`
- Decouple user identity from `spotify_id` — it becomes linked metadata, not the identity key
- Rewire onboarding to use extension-driven sync instead of direct Spotify API calls
- Complete migration within 5 days

**Non-Goals:**
- Email/password auth (social-only for now, can add later via Better Auth plugin)
- Rewriting the SSE job progress infrastructure (it stays as-is)
- Migrating existing users (0 users — clean break)
- Multi-tenant or organization support

## Decisions

### D1: Better Auth over Supabase Auth

**Choice**: Better Auth library
**Over**: Supabase Auth

**Rationale**:
- First-class TanStack Start integration via `tanstackStartCookies` plugin — Supabase Auth has no TanStack Start adapter
- Zero cost at any scale (library in our process) vs Supabase free tier pauses projects after 7 days of inactivity
- Data stays in our own Postgres tables — no separate `auth.users` schema to manage
- No vendor lock-in deepening — current "deny all + service_role" RLS strategy remains untouched
- Plugin ecosystem for future needs (MFA, passkeys, rate limiting) without switching providers

### D2: Drizzle ORM with `postgres` (postgres.js) driver

**Choice**: Drizzle ORM with `postgres` (postgres.js) driver
**Over**: Raw `pg` Pool, `@neondatabase/serverless`, Kysely adapter

**Rationale**:
- `postgres` (postgres.js) works with any standard PostgreSQL — local Supabase (`127.0.0.1:54322`) and Supabase's transaction pooler in production
- Cloudflare Workers now support TCP sockets via `cloudflare:sockets`, so `postgres.js` works there too (with Supabase transaction pooler or Hyperdrive)
- `@neondatabase/serverless` was initially chosen for edge HTTP compatibility but requires a Neon-hosted database — doesn't work with local Supabase Postgres
- `prepare: false` required for compatibility with Supabase's transaction pooler (no prepared statements in transaction mode)
- Drizzle is only used for Better Auth — existing app data access stays on `@supabase/supabase-js` with service_role
- A Drizzle schema file (`src/lib/auth-schema.ts`) maps Better Auth models to table definitions

**Connection setup**:
```typescript
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as authSchema from '@/lib/auth-schema';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(sql);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { ...authSchema, account: authSchema.oauthAccount },
  }),
  // ...
});
```

**Consideration**: Better Auth's `account` table name conflict still applies — use `modelName` to rename to `oauth_account` (see D3). The schema must explicitly map `account` to `oauthAccount` so the adapter resolves the renamed model. All Supabase schema changes must go through `supabase` CLI (`supabase migration new`, `supabase db push`).

### D3: Keep existing `account` table, add `better_auth_user_id` FK

**Choice**: Add column to existing table
**Over**: Replace `account` table with Better Auth's `user` table, or migrate all FKs

**Rationale**:
- 7 tables reference `account(id)` with CASCADE deletes — migrating all FKs is high-risk in a 5-day window
- Adding a single `better_auth_user_id UUID REFERENCES "user"(id)` column is a one-line migration
- Existing `account.id` UUIDs stay as the FK target for all dependent tables
- `spotify_id` becomes nullable (populated on first extension sync, not on login)
- Better Auth's `user` table holds email, name, image — our `account` table links to it

**Better Auth table name conflicts**:
- Better Auth wants to create `account` (for OAuth provider links) — rename to `oauth_account` via `modelName`
- Better Auth's `user`, `session`, `verification` tables don't conflict

```
┌──────────────────┐     ┌──────────────────┐
│ Better Auth user  │◄────│ oauth_account    │
│ (id, email, name) │     │ (provider links) │
└────────┬─────────┘     └──────────────────┘
         │ 1:1
         ▼
┌──────────────────┐     ┌──────────────┐
│ account (ours)    │◄────│ playlist     │
│ better_auth_      │◄────│ liked_song   │
│   user_id (FK)   │◄────│ job          │
│ spotify_id (null) │◄────│ preferences  │
│ display_name      │◄────│ item_status  │
│ email             │◄────│ match_context│
└──────────────────┘     └──────────────┘
```

### D4: Session pattern — `auth.api.getSession({ headers })` replaces `getSession(request)`

**Choice**: Thin wrapper around Better Auth's server-side session API
**Over**: Custom session extraction from cookies

**Rationale**:
- Better Auth manages session cookies, token rotation, and expiry internally
- `auth.api.getSession({ headers })` is the canonical way to validate sessions in server functions
- We create two helpers in `src/lib/auth.server.ts`:
  - `getAuthSession()` — returns session or null (for optional auth checks)
  - `requireAuthSession()` — returns session or throws redirect (for route guards)
- These replace `getSession(request)` and `requireSession(request)` from `session.ts`
- The `_authenticated/route.tsx` layout guard calls `requireAuthSession()` in `beforeLoad`

**Key difference**: Current `getSession()` takes a `Request` object. Better Auth's API takes `headers` (from `getRequestHeaders()`). Server functions use `getRequestHeaders()` from `@tanstack/react-start/server` instead of `getRequest()`.

### D5: Account creation on first login

**Choice**: Create our `account` record in a Better Auth hook/callback after social login
**Over**: Creating account in a separate step

**Rationale**:
- Better Auth fires hooks after successful authentication (e.g., `onUserCreated`, social login callbacks)
- On first social login: Better Auth creates its `user` record → our hook creates the `account` record with `better_auth_user_id` = user.id
- `spotify_id` is left null — populated later when the extension syncs and sends user profile data
- On subsequent logins: `account` already exists, no action needed

### D6: Bearer token via `externally_connectable` handoff

**Choice**: Bearer token via `externally_connectable` handoff
**Over**: Session cookies with `credentials: "include"`

**Rationale**:
- Chrome extension service worker `fetch()` with `credentials: "include"` has documented reliability issues — cookies sometimes not attached (known Chrome quirk requiring `chrome.cookies.get/set` workaround)
- Service worker requests send `Origin: null` — requires special CORS handling for `Access-Control-Allow-Credentials`
- Session cookie expiry requires user to revisit web app — no programmatic refresh path
- `SameSite=Lax` technically works (Chrome treats extension-to-host as same-site with `host_permissions`), but this is implicit behavior, not an explicit contract

**Bearer token flow**:
1. Extension declares `externally_connectable` with app origin in `manifest.json`
2. App detects extension via `chrome.runtime.sendMessage(EXTENSION_ID, { type: "PING" })`
3. User connects → app generates API token → sends to extension via `chrome.runtime.sendMessage`
4. Extension stores token in `chrome.storage.local`
5. All `postToBackend()` calls use `Authorization: Bearer <token>` header
6. Backend validates bearer token → resolves accountId
7. No cookies, no CORS credential issues, no `Origin: null` problems

**Token management**: API tokens stored in `api_token` table (or reuse existing token infrastructure). Tokens are long-lived, tied to account, revocable. Extension can check token validity via `/api/extension/status` with the Bearer header.

### D7: Onboarding flow rewire — extension-first sync

**Choice**: Replace "Connecting to Spotify" with "Install Extension + Sync" flow
**Over**: Keeping direct Spotify API sync path

**Rationale**:
- `getLibrarySummary()` and `executeSync()` call `getSpotifyService(accountId)` which requires Spotify OAuth tokens we no longer have
- Extension already does the full sync pipeline: fetch liked songs + playlists via Pathfinder → POST to `/api/extension/sync`
- New onboarding flow:
  1. Welcome → Pick Color → **Install Extension** → Syncing (triggered by extension) → Flag Playlists → Ready
  2. The "Install Extension" step detects whether extension is installed (via a content script message or `/api/extension/status` polling)
  3. Once extension is detected and user is logged in, trigger sync from extension
  4. SSE job progress infrastructure remains unchanged — extension sync writes to same DB tables

**State machine change**:
```
Before: WELCOME → PICK_COLOR → CONNECTING (Spotify API) → SYNCING → FLAG_PLAYLISTS → READY
After:  WELCOME → PICK_COLOR → INSTALL_EXTENSION → SYNCING (extension) → FLAG_PLAYLISTS → READY
```

### D8: Social provider configuration

**Choice**: Google as the initial social provider
**Over**: Google + Apple, or adding more providers immediately

**Rationale**:
- Google covers the majority of users and provides email
- Apple was initially planned but removed — requires Apple Developer account ($99/yr) and adds `trustedOrigins` complexity that caused CSRF issues with Better Auth
- Better Auth supports 20+ providers — adding Apple or others later is a config change, not a code change
- OAuth callback URL: `{BASE_URL}/api/auth/callback/google`

### D9: File organization

| File | Purpose |
|------|---------|
| `src/lib/auth.ts` | `betterAuth()` server config (database, providers, plugins, hooks) |
| `src/lib/auth-client.ts` | `createAuthClient()` for React (signIn, signOut, useSession) |
| `src/lib/auth.server.ts` | `getAuthSession()` + `requireAuthSession()` server functions |
| `src/routes/api/auth/$.ts` | Catch-all route handler → `auth.handler(request)` |

**Deleted files:**
- `src/lib/auth/cookies.ts` — Better Auth manages cookies
- `src/lib/auth/session.ts` — replaced by `auth.server.ts`
- `src/lib/auth/oauth.ts` — PKCE helpers no longer needed
- `src/lib/auth/guards.ts` — merged into `auth.server.ts`
- `src/routes/auth/spotify/index.tsx` — Spotify OAuth initiation
- `src/routes/auth/spotify/callback.tsx` — Spotify OAuth callback
- `src/lib/data/auth-tokens.ts` — Spotify token storage

**Modified files (session call sites):**
All 26 files referencing `accountId`/`session.accountId` need their session retrieval updated. The `accountId` value itself stays the same (our `account.id` UUID) — only how we get it changes.

## Risks / Trade-offs

**[Risk] Better Auth `account` table name conflict** → Rename to `oauth_account` via `modelName` config. Verify Better Auth's internal queries respect the rename.

**[Risk] Drizzle ORM as additional dependency** → Drizzle is only used for Better Auth's DB adapter. If Better Auth adds a native HTTP adapter in the future, Drizzle can be removed. Acceptable trade-off for edge runtime compatibility.

**[Risk] Extension must be installed for any data to flow** → Users who don't install the extension have an authenticated but empty app. Mitigate: make the "Install Extension" onboarding step clear and required, with a Chrome Web Store link.

**[Risk] `spotify_id` null for new users until first sync** → Any code that assumes `spotify_id` is NOT NULL will break. Audit all references before making the column nullable.

**[Risk] Bearer token storage in `chrome.storage.local`** → `chrome.storage.local` is not encrypted but is scoped to the extension. Tokens are long-lived and revocable. Token rotation strategy: tokens can be revoked from the web app, extension detects 401 and prompts re-connection. No refresh token complexity needed — if token is revoked, user re-connects via the app.

**[Trade-off] Two database clients** → `@supabase/supabase-js` (service_role) for app data + Drizzle + `postgres` (postgres.js) for Better Auth. Acceptable because they serve different purposes and don't interact.

**[Trade-off] No migration path** → 0 users means clean break is correct. If we had users, we'd need a migration layer to re-authenticate existing accounts.

**[Constraint] All Supabase database schema changes MUST go through `supabase` CLI (`supabase migration new <name>`, `supabase db push`). Never use MCP tools or direct SQL for DDL operations.**

## Migration Plan

### Phase 0: Runtime validation (Day 0)
1. Create minimal Better Auth + Drizzle + postgres.js setup
2. Verify auth endpoints respond locally (sign-in, get-session, callback)
3. Verify Drizzle schema maps all Better Auth models (user, session, oauth_account, verification)

### Phase 1: Auth swap (Days 1-2)
1. Install `better-auth`, `drizzle-orm`, `postgres` packages
2. Create Better Auth config (`src/lib/auth.ts`) with Google provider
3. Run `bunx @better-auth/cli generate` to get migration SQL for Better Auth tables
4. Apply migration: create Better Auth tables + add `better_auth_user_id` to `account` + make `spotify_id` nullable
5. Create catch-all route handler at `src/routes/api/auth/$.ts`
6. Create auth client (`src/lib/auth-client.ts`) and server helpers (`src/lib/auth.server.ts`)
7. Update `_authenticated/route.tsx` to use new `requireAuthSession()`
8. Update all `getSession()`/`requireSession()` call sites (26 files)
9. Delete old auth files (cookies.ts, session.ts, oauth.ts, guards.ts, auth routes)
10. Delete `auth_token` table migration (or mark as deprecated)
11. Create login page with Google button

### Phase 2: Onboarding rewire (Days 3-4)
1. Replace `ConnectingStep` with `InstallExtensionStep` component
2. Update onboarding state machine (new step value: `install-extension`)
3. Remove `getLibrarySummary()` and `executeSync()` Spotify API dependency
4. Wire sync trigger: extension detects logged-in user → triggers sync → progress shown via existing SSE
5. Update `onboarding.functions.ts` server functions

### Phase 3: Cleanup + extension update (Day 5)
1. Update extension to use bearer token auth instead of `credentials: "include"`
2. Implement token generation endpoint and `api_token` storage
3. Add `spotify_id` linking: first sync POSTs user profile → backend links `spotify_id` to account
4. Update `/api/extension/sync` and `/api/extension/status` to validate bearer token
5. Remove `@fostertheweb/spotify-web-sdk` dependency if no longer used
6. Clean up unused Spotify integration code that depended on user OAuth tokens

### Rollback strategy
- Git branch: all changes on `feature/auth-migration-better-auth`
- Database: Better Auth tables are additive (new tables + one new column). Rollback = revert branch + drop new tables
- No data to preserve (0 users)

## Open Questions

1. **Client Credentials (`app_token`)**: Does Spotify also revoke Client Credentials flow (used for album art, artist metadata)? If yes, those lookups need alternative sources or must be cached from extension data.
2. **Extension detection**: Use `chrome.runtime.sendMessage` with `externally_connectable` for detection from web app. The bearer token handoff flow naturally includes extension detection as step 1 — if the extension responds to PING, it's installed.
3. ~~**Cloudflare Workers compatibility**~~ **Resolved**: Using `postgres` (postgres.js) with `drizzle-orm/postgres-js`. CF Workers now support TCP sockets via `cloudflare:sockets`. For production, use Supabase's transaction pooler endpoint with `prepare: false`.
