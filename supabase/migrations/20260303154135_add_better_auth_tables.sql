-- Better Auth tables (user, session, oauth_account, verification)
-- + Link existing account table via better_auth_user_id
-- + Make spotify_id nullable (identity decoupled from Spotify)

-- 1. Better Auth: user table
CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    image TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Better Auth: session table
CREATE TABLE "session" (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Better Auth: oauth_account table (renamed from "account" via modelName)
CREATE TABLE "oauth_account" (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    access_token_expires_at TIMESTAMPTZ,
    scope TEXT,
    id_token TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Better Auth: verification table
CREATE TABLE "verification" (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Link our account table to Better Auth user
ALTER TABLE account
    ADD COLUMN better_auth_user_id TEXT REFERENCES "user"(id);

-- 6. Make spotify_id nullable (populated on first extension sync, not on login)
ALTER TABLE account
    ALTER COLUMN spotify_id DROP NOT NULL;

-- 7. Indexes
CREATE INDEX idx_session_user_id ON "session"(user_id);
CREATE INDEX idx_session_token ON "session"(token);
CREATE INDEX idx_oauth_account_user_id ON oauth_account(user_id);
CREATE INDEX idx_verification_identifier ON verification(identifier);
CREATE INDEX idx_account_better_auth_user_id ON account(better_auth_user_id);

-- 8. RLS: deny all for anon/authenticated (postgres and service_role bypass via BYPASSRLS)
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification ENABLE ROW LEVEL SECURITY;
