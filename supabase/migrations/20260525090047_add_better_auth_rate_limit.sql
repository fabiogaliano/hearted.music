-- Better Auth: rate_limit table
-- Backs `rateLimit.storage: "database"` so login throttling survives across
-- Cloudflare Worker isolates (in-memory storage, Better Auth's default, resets
-- per isolate and cannot rate limit on Workers).
-- Must stay in sync with the `rateLimit` table in
-- src/lib/platform/auth/auth-schema.ts.

CREATE TABLE "rate_limit" (
    id TEXT PRIMARY KEY,
    key TEXT,
    count INTEGER,
    last_request BIGINT
);

CREATE INDEX idx_rate_limit_key ON "rate_limit"(key);

-- RLS: deny all for anon/authenticated. Better Auth reaches this table over the
-- direct postgres connection (BYPASSRLS), never via PostREST.
ALTER TABLE "rate_limit" ENABLE ROW LEVEL SECURITY;
