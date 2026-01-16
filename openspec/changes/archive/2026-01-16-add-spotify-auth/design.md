# Design: Spotify Authentication

## Context

Implementing Spotify OAuth with PKCE flow for a TanStack Start app deployed to Cloudflare Workers. Tokens must be stored securely server-side in Supabase.

## Goals

- Users can log in with their Spotify account
- Tokens are stored securely (not in localStorage)
- Token refresh happens automatically
- Works on both local and cloud environments

## Non-Goals

- Social login (Google, GitHub, etc.) — Spotify only
- Supabase Auth integration — using custom auth
- Multiple Spotify accounts per user

## PKCE Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │     │   Server    │     │   Spotify   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ 1. Click Login    │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │ Generate:         │
       │                   │ - code_verifier   │
       │                   │ - code_challenge  │
       │                   │ - state           │
       │                   │ Store in cookie   │
       │                   │                   │
       │ 2. Redirect       │                   │
       │<──────────────────│                   │
       │                   │                   │
       │ 3. /authorize + code_challenge        │
       │───────────────────────────────────────>
       │                   │                   │
       │ 4. User approves  │                   │
       │<───────────────────────────────────────
       │   ?code=xxx&state=yyy                 │
       │                   │                   │
       │ 5. /auth/callback │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │ 6. POST /api/token
       │                   │   + code_verifier │
       │                   │──────────────────>│
       │                   │                   │
       │                   │ 7. tokens         │
       │                   │<──────────────────│
       │                   │                   │
       │                   │ 8. Store in DB    │
       │                   │ 9. Set session    │
       │                   │                   │
       │ 10. Redirect home │                   │
       │<──────────────────│                   │
```

## Decisions

### D1: Server-side token storage
**Decision**: Store access_token and refresh_token server-side in Supabase `auth_token` table (not in cookies/localStorage).
**Rationale**: Tokens in localStorage are vulnerable to XSS. Server-side storage with HTTP-only session cookies is more secure.
**Trade-off**: Slightly more complex, but standard security practice.

### D2: Session management via cookies
**Decision**: Use HTTP-only, secure, SameSite=Lax cookies for session ID.
**Rationale**: Works with SSR, secure by default, no client-side token handling.
**Alternative**: JWT in cookie — more complex, not needed for this use case.

### D3: Code verifier storage
**Decision**: Store code_verifier in HTTP-only cookie during OAuth flow (short-lived).
**Rationale**: Must persist across redirect but shouldn't be in localStorage.
**Alternative**: Server-side session store — overkill for this temporary value.

### D4: Separate auth_token table
**Decision**: Store tokens in dedicated `auth_token` table, not in `account`.
```sql
account (
  id UUID PRIMARY KEY,
  spotify_id TEXT UNIQUE NOT NULL,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)

auth_token (
  id UUID PRIMARY KEY,
  account_id UUID UNIQUE NOT NULL REFERENCES account(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)
```
**Rationale**: Clean separation of identity vs credentials. Easier to rotate/revoke tokens without touching account. Aligns with v2 schema philosophy of single-responsibility tables.

### D5: Auto token refresh
**Decision**: Check token expiry before each API call, refresh if needed.
**Rationale**: Transparent to calling code, no manual refresh handling.
**Implementation**: Wrapper function that checks `token_expires_at`.

### D6: RLS via service role
**Decision**: All server functions use `service_role` client. RLS policies exist but aren't actively used for auth.
**Rationale**: Aligns with v2 Decision #050. Custom auth means we can't use `auth.uid()`. Service role bypasses RLS; we enforce ownership via explicit `account_id` checks in code.
**Trade-off**: Less database-level security, but simpler implementation. App code is the trust boundary.

## Database Schema

### account table
```sql
CREATE TABLE account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id TEXT UNIQUE NOT NULL,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS enabled but service_role bypasses it
ALTER TABLE account ENABLE ROW LEVEL SECURITY;
```

### auth_token table
```sql
CREATE TABLE auth_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID UNIQUE NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS enabled but service_role bypasses it
ALTER TABLE auth_token ENABLE ROW LEVEL SECURITY;

-- Index for token lookup by account
CREATE INDEX idx_auth_token_account_id ON auth_token(account_id);
```

## File Structure

```
src/
├── routes/
│   └── auth/
│       ├── spotify.tsx      # GET: Initiate OAuth
│       ├── callback.tsx     # GET: Handle redirect
│       └── logout.tsx       # POST: Clear session
├── lib/
│   ├── auth/
│   │   ├── session.ts       # Cookie-based session
│   │   ├── oauth.ts         # PKCE helpers
│   │   └── middleware.ts    # Auth check for routes
│   └── spotify/
│       └── client.ts        # API client with auto-refresh
```

## Environment Variables

```env
# Spotify OAuth (from developer.spotify.com/dashboard)
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/auth/callback

# Supabase (server-side only)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Session
SESSION_SECRET=random_32_char_string
```

Note: No `SPOTIFY_CLIENT_SECRET` needed for PKCE flow on frontend.
Server-side token exchange still needs it — store it securely.
`SUPABASE_SERVICE_ROLE_KEY` is server-only and must never reach the client.

## Risks / Trade-offs

| Risk                 | Mitigation                                               |
| -------------------- | -------------------------------------------------------- |
| Token leak via logs  | Never log tokens, use structured logging                 |
| Session fixation     | Regenerate session ID on login                           |
| CSRF on logout       | Use POST with state verification                         |
| Refresh token expiry | Spotify refresh tokens are long-lived, handle gracefully |

## Resolved Questions

1. **Service role key**: Should we use service role for token storage or create RLS policy?
   - ✅ **Resolved**: Use service role (D6). Custom auth can't use `auth.uid()`. Enforce ownership in code.

2. **Multiple devices**: Same user on multiple devices?
   - ✅ **Resolved**: Single token set per account (new login overwrites). `auth_token.account_id` is UNIQUE.

3. **Token storage location**: Cookie vs database?
   - ✅ **Resolved**: Database (`auth_token` table). Enables background jobs and server-side operations.

4. **Schema design**: Tokens in account table vs separate table?
   - ✅ **Resolved**: Separate `auth_token` table (D4). Clean separation of identity vs credentials.
