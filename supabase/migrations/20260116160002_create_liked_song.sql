-- Create liked_song junction table for account's liked songs (soft delete pattern)

CREATE TABLE liked_song (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  liked_at TIMESTAMPTZ NOT NULL,
  unliked_at TIMESTAMPTZ,  -- NULL = active, non-NULL = soft deleted
  status TEXT,  -- NULL = pending, 'matched', 'ignored'
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(account_id, song_id)
);

-- status values:
-- NULL = pending (not yet matched to a playlist)
-- 'matched' = song has been added to a destination playlist
-- 'ignored' = user explicitly skipped this song

-- Indexes for common queries
CREATE INDEX idx_liked_song_account_id ON liked_song(account_id);
CREATE INDEX idx_liked_song_song_id ON liked_song(song_id);
CREATE INDEX idx_liked_song_liked_at ON liked_song(account_id, liked_at DESC);

-- Partial index for pending songs (active and not yet matched)
CREATE INDEX idx_liked_song_pending ON liked_song(account_id)
  WHERE unliked_at IS NULL AND status IS NULL;

-- Enable RLS (service_role bypasses)
ALTER TABLE liked_song ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER liked_song_updated_at
  BEFORE UPDATE ON liked_song
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
