-- Create playlist_song junction table for playlist tracks

CREATE TABLE playlist_song (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(playlist_id, song_id)
);

-- Indexes for common queries
CREATE INDEX idx_playlist_song_playlist_id ON playlist_song(playlist_id);
CREATE INDEX idx_playlist_song_song_id ON playlist_song(song_id);
CREATE INDEX idx_playlist_song_position ON playlist_song(playlist_id, position);

-- Enable RLS (service_role bypasses)
ALTER TABLE playlist_song ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER playlist_song_updated_at
  BEFORE UPDATE ON playlist_song
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
