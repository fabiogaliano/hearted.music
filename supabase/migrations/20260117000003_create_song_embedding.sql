-- Create song_embedding table for vector embeddings (global, similarity search)

CREATE TABLE song_embedding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,  -- 'song_semantic', 'audio_features', etc.
  model TEXT NOT NULL,
  model_version TEXT,
  dims INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(song_id, kind, model, model_version, content_hash)
);

-- content_hash: SHA256 of input content for deduplication
-- If the input hasn't changed, we can skip re-embedding

-- Index for joins with song table
CREATE INDEX idx_song_embedding_song_id ON song_embedding(song_id);

-- HNSW index for fast approximate nearest neighbor search
-- m: max connections per node (higher = better recall, more memory)
-- ef_construction: search depth during index build (higher = better quality)
CREATE INDEX idx_song_embedding_hnsw ON song_embedding
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Enable RLS (service_role bypasses)
ALTER TABLE song_embedding ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER song_embedding_updated_at
  BEFORE UPDATE ON song_embedding
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
