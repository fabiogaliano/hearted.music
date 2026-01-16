-- Create song table for Spotify track metadata

CREATE TABLE song (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  artists JSONB NOT NULL DEFAULT '[]',
  album_name TEXT,
  album_id TEXT,
  duration_ms INTEGER,
  popularity INTEGER,
  preview_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast lookup by Spotify ID
CREATE INDEX idx_song_spotify_id ON song(spotify_id);

-- Enable RLS (service_role bypasses)
ALTER TABLE song ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER song_updated_at
  BEFORE UPDATE ON song
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
