-- Create playlist_profile table for playlist vector profiles (matching)

CREATE TABLE playlist_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  embedding vector(1024),
  audio_centroid JSONB,
  genre_distribution JSONB,
  emotion_distribution JSONB,
  model_name TEXT,
  model_version TEXT,
  song_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(playlist_id)
);

-- audio_centroid JSONB structure (aggregated audio features):
-- {
--   "energy": 0.65,
--   "danceability": 0.58,
--   "valence": 0.42,
--   "tempo": 115.5,
--   "acousticness": 0.35
-- }

-- genre_distribution JSONB structure:
-- {
--   "indie rock": 0.35,
--   "alternative": 0.28,
--   "dream pop": 0.15,
--   "shoegaze": 0.12
-- }

-- emotion_distribution JSONB structure:
-- {
--   "melancholic": 0.4,
--   "nostalgic": 0.3,
--   "hopeful": 0.2
-- }

-- Index for joins with playlist table
CREATE INDEX idx_playlist_profile_playlist_id ON playlist_profile(playlist_id);

-- HNSW index for playlist embedding similarity search
CREATE INDEX idx_playlist_profile_hnsw ON playlist_profile
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- Enable RLS (service_role bypasses)
ALTER TABLE playlist_profile ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER playlist_profile_updated_at
  BEFORE UPDATE ON playlist_profile
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
