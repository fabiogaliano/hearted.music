-- Create playlist table for Spotify playlists

CREATE TABLE playlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  spotify_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  snapshot_id TEXT,
  is_public BOOLEAN DEFAULT false,
  track_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(account_id, spotify_id)
);

-- Indexes for common lookups
CREATE INDEX idx_playlist_account_id ON playlist(account_id);
CREATE INDEX idx_playlist_spotify_id ON playlist(spotify_id);

-- Enable RLS (service_role bypasses)
ALTER TABLE playlist ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER playlist_updated_at
  BEFORE UPDATE ON playlist
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
