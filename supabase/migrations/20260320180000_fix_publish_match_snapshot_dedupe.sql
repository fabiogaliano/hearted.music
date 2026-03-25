-- Fix publish_match_snapshot() deduplication logic.
--
-- Previous version: no-ops if context_hash exists anywhere in history.
-- Bug: A -> B -> A transition returns NULL for the second A, leaving stale B
--      as the latest snapshot (the app reads by created_at DESC).
--
-- Fixed version: no-ops only if context_hash matches the LATEST published
-- context for this account, so reverting to a prior state publishes correctly.

CREATE OR REPLACE FUNCTION publish_match_snapshot(
  p_account_id UUID,
  p_algorithm_version TEXT,
  p_config_hash TEXT,
  p_playlist_set_hash TEXT,
  p_candidate_set_hash TEXT,
  p_context_hash TEXT,
  p_playlist_count INTEGER,
  p_song_count INTEGER,
  p_results JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  v_context_id UUID;
  v_latest_hash TEXT;
BEGIN
  -- No-op only if the LATEST published context already has this hash.
  -- Checking any historical row would break A -> B -> A state reversion.
  SELECT context_hash INTO v_latest_hash
  FROM match_context
  WHERE account_id = p_account_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest_hash = p_context_hash THEN
    RETURN NULL;
  END IF;

  -- Insert new context
  INSERT INTO match_context (
    account_id, algorithm_version, config_hash,
    playlist_set_hash, candidate_set_hash, context_hash,
    playlist_count, song_count
  ) VALUES (
    p_account_id, p_algorithm_version, p_config_hash,
    p_playlist_set_hash, p_candidate_set_hash, p_context_hash,
    p_playlist_count, p_song_count
  ) RETURNING id INTO v_context_id;

  -- Insert results if any
  IF jsonb_array_length(p_results) > 0 THEN
    INSERT INTO match_result (context_id, song_id, playlist_id, score, rank, factors)
    SELECT
      v_context_id,
      (r->>'song_id')::UUID,
      (r->>'playlist_id')::UUID,
      (r->>'score')::DOUBLE PRECISION,
      (r->>'rank')::INTEGER,
      COALESCE(r->'factors', '{}'::JSONB)
    FROM jsonb_array_elements(p_results) AS r;
  END IF;

  RETURN v_context_id;
END;
$$;
