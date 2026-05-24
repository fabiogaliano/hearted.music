-- Better Auth: add credential-auth columns to oauth_account.
-- - password: scrypt hash for provider_id = 'credential' rows; NULL for OAuth rows
-- - refresh_token_expires_at: core Better Auth field missing from the initial migration
--
-- Drizzle schema (src/lib/platform/auth/auth-schema.ts) must already define both columns.
-- RLS on oauth_account is "deny all" + service_role bypass; no policy change needed.

ALTER TABLE oauth_account
    ADD COLUMN password TEXT,
    ADD COLUMN refresh_token_expires_at TIMESTAMPTZ;
