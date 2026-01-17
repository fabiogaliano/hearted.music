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
  playlist_hashes JSONB NOT NULL DEFAULT '{}',
  song_count INTEGER NOT NULL DEFAULT 0,
  playlist_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- weights JSONB structure (algorithm weight configuration):
-- {
--   "embedding_similarity": 0.4,
--   "audio_feature_match": 0.3,
--   "genre_overlap": 0.2,
--   "mood_alignment": 0.1
-- }

-- playlist_hashes JSONB structure (content hashes for reproducibility):
-- {
--   "playlist_uuid_1": "sha256_hash_of_song_ids",
--   "playlist_uuid_2": "sha256_hash_of_song_ids"
-- }

-- Index for querying by account
CREATE INDEX idx_match_context_account_id ON match_context(account_id);

-- Index for querying latest context
CREATE INDEX idx_match_context_latest ON match_context(account_id, created_at DESC);

-- Enable RLS (service_role bypasses)
ALTER TABLE match_context ENABLE ROW LEVEL SECURITY;
