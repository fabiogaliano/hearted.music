-- Create playlist_analysis table for LLM playlist analysis results (global)
-- Multiple analyses can exist per playlist (different models, prompt versions, or re-runs)

CREATE TABLE playlist_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
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
--   "vibe": "chill indie afternoon",
--   "mood_profile": ["relaxed", "nostalgic", "dreamy"],
--   "tempo_profile": "mostly mid-tempo (90-110 BPM)",
--   "cohesion_score": 0.82,
--   "description": "A collection of indie tracks perfect for..."
-- }

-- Index for getting latest analysis per playlist (ordered by created_at DESC)
CREATE INDEX idx_playlist_analysis_playlist_created
  ON playlist_analysis(playlist_id, created_at DESC);

-- Enable RLS (service_role bypasses)
ALTER TABLE playlist_analysis ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER playlist_analysis_updated_at
  BEFORE UPDATE ON playlist_analysis
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
