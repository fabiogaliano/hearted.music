-- Create song_analysis table for LLM analysis results

CREATE TABLE song_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  analysis JSONB NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(song_id, model_name)
);

-- analysis JSONB structure (example):
-- {
--   "mood": ["melancholic", "introspective"],
--   "themes": ["heartbreak", "nostalgia"],
--   "energy_description": "slow build with emotional crescendo",
--   "genre_hints": ["indie rock", "alternative"],
--   "listening_contexts": ["late night", "reflective moments"]
-- }

-- Index for joins with song table
CREATE INDEX idx_song_analysis_song_id ON song_analysis(song_id);

-- Index for querying by model
CREATE INDEX idx_song_analysis_model ON song_analysis(model_name);

-- Enable RLS (service_role bypasses)
ALTER TABLE song_analysis ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER song_analysis_updated_at
  BEFORE UPDATE ON song_analysis
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
