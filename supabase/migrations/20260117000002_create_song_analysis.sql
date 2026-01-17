-- Create song_analysis table for LLM analysis results (global, not user-owned)
-- Multiple analyses per song are allowed (different models, prompt versions, or re-runs)

CREATE TABLE song_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  analysis JSONB NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT,
  tokens_used INTEGER,
  cost_cents INTEGER,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- analysis JSONB structure (example):
-- {
--   "mood": ["melancholic", "introspective"],
--   "themes": ["heartbreak", "nostalgia"],
--   "energy_description": "slow build with emotional crescendo",
--   "genre_hints": ["indie rock", "alternative"],
--   "listening_contexts": ["late night", "reflective moments"]
-- }

-- Index for getting latest analysis per song (ordered by created_at DESC)
CREATE INDEX idx_song_analysis_song_created ON song_analysis(song_id, created_at DESC);

-- Enable RLS (service_role bypasses)
ALTER TABLE song_analysis ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER song_analysis_updated_at
  BEFORE UPDATE ON song_analysis
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
