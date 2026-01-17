-- Create match_context table for capturing matching configuration snapshots

CREATE TABLE match_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  algorithm_version TEXT NOT NULL,
  embedding_model TEXT,
  embedding_version TEXT,
  analysis_model TEXT,
  analysis_version TEXT,
  weights JSONB NOT NULL DEFAULT '{}',
  config_hash TEXT NOT NULL,  -- Hash of algorithm configuration
  playlist_set_hash TEXT NOT NULL,  -- Hash of destination playlist IDs
  candidate_set_hash TEXT NOT NULL,  -- Hash of candidate song IDs
  context_hash TEXT NOT NULL UNIQUE,  -- Unique identifier for this exact context
  playlist_count INTEGER NOT NULL DEFAULT 0,
  song_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- weights JSONB structure (algorithm weight configuration):
-- {
--   "embedding_similarity": 0.4,
--   "audio_feature_match": 0.3,
--   "genre_overlap": 0.2,
--   "mood_alignment": 0.1
-- }

-- Hash strategy for reproducibility:
-- config_hash = SHA256(algorithm_version + weights + model versions)
-- playlist_set_hash = SHA256(sorted playlist IDs)
-- candidate_set_hash = SHA256(sorted candidate song IDs)
-- context_hash = SHA256(config_hash + playlist_set_hash + candidate_set_hash)

-- Index for querying by account
CREATE INDEX idx_match_context_account_id ON match_context(account_id);

-- Index for querying latest context
CREATE INDEX idx_match_context_latest ON match_context(account_id, created_at DESC);

-- Index for context_hash lookups
CREATE INDEX idx_match_context_hash ON match_context(context_hash);

-- Enable RLS (service_role bypasses)
ALTER TABLE match_context ENABLE ROW LEVEL SECURITY;
