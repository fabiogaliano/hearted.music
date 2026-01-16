-- Create liked_song junction table for account's liked songs

CREATE TABLE liked_song (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  liked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(account_id, song_id)
);

-- Indexes for common queries
CREATE INDEX idx_liked_song_account_id ON liked_song(account_id);
CREATE INDEX idx_liked_song_song_id ON liked_song(song_id);
CREATE INDEX idx_liked_song_liked_at ON liked_song(account_id, liked_at DESC);

-- Enable RLS (service_role bypasses)
ALTER TABLE liked_song ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER liked_song_updated_at
  BEFORE UPDATE ON liked_song
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
