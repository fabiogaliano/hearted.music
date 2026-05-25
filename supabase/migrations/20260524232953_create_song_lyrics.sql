-- Create song_lyrics table: persisted lyrics + annotations per song, per source (global cache).
--
-- The `document` column stores a versioned envelope:
--   { "schemaVersion": 1, "source": "genius", "sections": TransformedLyricsBySection[] }
-- where each section's lines carry their annotations inline (Genius line-splitting).
-- `source` is the pluggable axis: one row per (song, source) lets future providers
-- coexist without a schema change.

CREATE TABLE song_lyrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  source TEXT NOT NULL,  -- 'genius', 'lrclib', etc.
  document JSONB NOT NULL,
  content_hash TEXT NOT NULL,  -- hash of the document; skip re-writes when unchanged
  has_annotations BOOLEAN NOT NULL DEFAULT false,
  schema_version SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(song_id, source)
);

-- Index for joins with song table
CREATE INDEX idx_song_lyrics_song_id ON song_lyrics(song_id);

-- Enable RLS (service_role bypasses; lyrics are written by the enrichment worker only)
ALTER TABLE song_lyrics ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER song_lyrics_updated_at
  BEFORE UPDATE ON song_lyrics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
