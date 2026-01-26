-- Singleton table for app-level Spotify token
CREATE TABLE app_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure only one row (singleton pattern)
CREATE UNIQUE INDEX app_token_singleton ON app_token ((true));

-- RLS: Only service role can access
ALTER TABLE app_token ENABLE ROW LEVEL SECURITY;
