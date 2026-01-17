-- Create user_preferences table for theme and onboarding state

-- Theme enum for UI color themes
CREATE TYPE theme AS ENUM ('blue', 'green', 'rose', 'lavender');

CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  theme theme NOT NULL DEFAULT 'blue',
  onboarding_step TEXT NOT NULL DEFAULT 'welcome',
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(account_id)
);

-- onboarding_step values (string-based for flexibility):
-- 'welcome' = initial welcome screen
-- 'pick-color' = theme selection
-- 'connecting' = waiting for Spotify auth
-- 'syncing' = initial sync in progress
-- 'flag-playlists' = user marking destination playlists
-- 'ready' = setup complete, ready to use
-- 'complete' = onboarding finished (onboarding_completed_at set)

-- Index for fast lookup by account
CREATE INDEX idx_user_preferences_account_id ON user_preferences(account_id);

-- Enable RLS (service_role bypasses)
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
