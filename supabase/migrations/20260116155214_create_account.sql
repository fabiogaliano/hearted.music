-- Create account table for Spotify user identity

CREATE TABLE account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id TEXT UNIQUE NOT NULL,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast lookup by Spotify ID
CREATE INDEX idx_account_spotify_id ON account(spotify_id);

-- Enable RLS (service_role bypasses)
ALTER TABLE account ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_updated_at
  BEFORE UPDATE ON account
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
