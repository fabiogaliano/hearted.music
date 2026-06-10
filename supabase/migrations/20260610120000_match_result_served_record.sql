-- Make match_result the COMPLETE, immutable "as served" record (matching roadmap #6).
--
-- The persisted snapshot was dropping two pieces of what the user actually saw:
--   normalized_factors — the z-scored per-signal values actually summed into the
--     served score. Raw `factors` (pre-normalization cosines/overlaps) cannot
--     reconstruct the ranking, because fusion happens on the normalized values.
--   fused_score — the pre-rerank weighted-sum score. The reranker overwrites
--     `score` in place, so without this the retrieval score is lost once a rerank
--     runs. Keeping BOTH lets offline replay separate retrieval quality from
--     rerank quality (fused_score = retrieval, score = final/post-rerank).
--
-- Preprod: the existing match_result rows are throwaway and matching is re-run to
-- repopulate. normalized_factors back-fills to '{}' on the old rows (mirrors
-- `factors`); fused_score stays NULL on them. Both are always populated for new
-- rows by the single write path (publish_match_snapshot, below) — the column is
-- left nullable only so this additive ALTER doesn't have to rewrite throwaway rows.

ALTER TABLE match_result
  ADD COLUMN normalized_factors JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN fused_score REAL;

-- normalized_factors JSONB structure (the fusion inputs, post candidate-set
-- normalization), mirroring the raw `factors` shape:
-- { "embedding": 0.71, "audio": 0.42, "genre": 0.58 }

-- ─────────────────────────────────────────────────────────────────────────────
-- Carry normalized_factors + fused_score through the publish path.
-- Same signature as 20260402235223 (params unchanged) — only the result INSERT
-- changes — so CREATE OR REPLACE is sufficient (no DROP needed).
--
-- SET search_path is pinned INLINE because CREATE OR REPLACE discards config
-- settings attached by ALTER FUNCTION — without it this would silently undo the
-- SECURITY DEFINER hardening from 20260330000001/20260519110000.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION publish_match_snapshot(
  p_account_id UUID,
  p_algorithm_version TEXT,
  p_config_hash TEXT,
  p_playlist_set_hash TEXT,
  p_candidate_set_hash TEXT,
  p_snapshot_hash TEXT,
  p_playlist_count INTEGER,
  p_song_count INTEGER,
  p_results JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id UUID;
  v_latest_hash TEXT;
BEGIN
  -- No-op only if the LATEST published snapshot already has this hash.
  SELECT snapshot_hash INTO v_latest_hash
  FROM match_snapshot
  WHERE account_id = p_account_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest_hash = p_snapshot_hash THEN
    RETURN NULL;
  END IF;

  -- Insert new snapshot
  INSERT INTO match_snapshot (
    account_id, algorithm_version, config_hash,
    playlist_set_hash, candidate_set_hash, snapshot_hash,
    playlist_count, song_count
  ) VALUES (
    p_account_id, p_algorithm_version, p_config_hash,
    p_playlist_set_hash, p_candidate_set_hash, p_snapshot_hash,
    p_playlist_count, p_song_count
  ) RETURNING id INTO v_snapshot_id;

  -- Insert results if any
  IF jsonb_array_length(p_results) > 0 THEN
    INSERT INTO match_result (
      snapshot_id, song_id, playlist_id,
      score, fused_score, rank, factors, normalized_factors
    )
    SELECT
      v_snapshot_id,
      (r->>'song_id')::UUID,
      (r->>'playlist_id')::UUID,
      (r->>'score')::DOUBLE PRECISION,
      (r->>'fused_score')::DOUBLE PRECISION,
      (r->>'rank')::INTEGER,
      COALESCE(r->'factors', '{}'::JSONB),
      COALESCE(r->'normalized_factors', '{}'::JSONB)
    FROM jsonb_array_elements(p_results) AS r;
  END IF;

  RETURN v_snapshot_id;
END;
$$;
