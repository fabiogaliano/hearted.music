-- Create auth_token table for Spotify OAuth tokens

CREATE TABLE auth_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID UNIQUE NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast token lookup by account
CREATE INDEX idx_auth_token_account_id ON auth_token(account_id);

-- Enable RLS (service_role bypasses)
ALTER TABLE auth_token ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER auth_token_updated_at
  BEFORE UPDATE ON auth_token
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
