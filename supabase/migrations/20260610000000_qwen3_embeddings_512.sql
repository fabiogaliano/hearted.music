-- Switch embeddings from intfloat/multilingual-e5-large-instruct (1024d) to
-- Qwen/Qwen3-Embedding-0.6B Matryoshka-truncated to 512d, with the corrected
-- instruct format. See docs/architecture/matching-system-roadmap.md #2/#3.
--
-- Pre-production reset: the existing vectors were embedded in the wrong format
-- (non-instruct query:/passage: prefixes) and at a different dimension, so they
-- are not comparable to the new ones. We drop them rather than migrate — there
-- is no value in keeping 1024d e5 rows that nothing will ever query again.
-- A clean re-embed + re-profile repopulates both tables (see scripts/).

-- HNSW indexes pin the column dimension, so they must go before the type change.
DROP INDEX IF EXISTS idx_song_embedding_hnsw;
DROP INDEX IF EXISTS idx_playlist_profile_hnsw;

-- Discard the old-format / old-dimension vectors.
DELETE FROM song_embedding;
DELETE FROM playlist_profile;

-- Narrow the vector columns to the new 512d target.
ALTER TABLE song_embedding
  ALTER COLUMN embedding TYPE extensions.vector(512);
ALTER TABLE playlist_profile
  ALTER COLUMN embedding TYPE extensions.vector(512);

-- Recreate the ANN indexes at the new dimension (unchanged params; the
-- playlist index stays partial since the column is nullable).
CREATE INDEX idx_song_embedding_hnsw ON song_embedding
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_playlist_profile_hnsw ON playlist_profile
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;
