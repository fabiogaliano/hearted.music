-- Create match_result table for song-to-playlist match scores

CREATE TABLE match_result (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id UUID NOT NULL REFERENCES match_context(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  rank INTEGER,
  factors JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(context_id, song_id, playlist_id)
);

-- factors JSONB structure (breakdown of score components):
-- {
--   "embedding_similarity": 0.85,
--   "audio_feature_match": 0.72,
--   "genre_overlap": 0.60,
--   "mood_alignment": 0.78,
--   "weighted_sum": 0.76
-- }

-- Index for querying by context
CREATE INDEX idx_match_result_context_id ON match_result(context_id);

-- Index for querying matches for a specific song
CREATE INDEX idx_match_result_song_id ON match_result(song_id);

-- Index for querying matches for a specific playlist
CREATE INDEX idx_match_result_playlist_id ON match_result(playlist_id);

-- Index for retrieving top matches efficiently
CREATE INDEX idx_match_result_score ON match_result(context_id, score DESC);

-- Index for ranked results
CREATE INDEX idx_match_result_rank ON match_result(context_id, song_id, rank)
  WHERE rank IS NOT NULL;

-- Enable RLS (service_role bypasses)
ALTER TABLE match_result ENABLE ROW LEVEL SECURITY;
