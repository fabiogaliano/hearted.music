-- Target playlist match refresh: indexes, worker RPCs, atomic publish function
-- Depends on the enum value added in the previous migration.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX idx_playlist_target ON playlist(account_id) WHERE is_target = true;

CREATE UNIQUE INDEX idx_unique_active_target_playlist_match_refresh_per_account
  ON job (account_id)
  WHERE type = 'target_playlist_match_refresh' AND status IN ('pending', 'running');

CREATE INDEX idx_job_target_playlist_match_refresh_poll
  ON job(type, status, created_at)
  WHERE type = 'target_playlist_match_refresh' AND status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Claim / sweep / dead-letter RPCs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION claim_pending_target_playlist_match_refresh_job()
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
AS $$
  UPDATE job
  SET
    status = 'running',
    attempts = attempts + 1,
    started_at = now(),
    heartbeat_at = now(),
    updated_at = now()
  WHERE id = (
    SELECT id FROM job
    WHERE type = 'target_playlist_match_refresh' AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION sweep_stale_target_playlist_match_refresh_jobs(stale_threshold INTERVAL)
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
AS $$
  UPDATE job
  SET
    status = 'pending',
    started_at = NULL,
    heartbeat_at = NULL,
    updated_at = now()
  WHERE id IN (
    SELECT id FROM job
    WHERE type = 'target_playlist_match_refresh'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts < max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION mark_dead_target_playlist_match_refresh_jobs(stale_threshold INTERVAL)
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
AS $$
  UPDATE job
  SET
    status = 'failed',
    completed_at = now(),
    error = 'max attempts exhausted after stale detection',
    updated_at = now()
  WHERE id IN (
    SELECT id FROM job
    WHERE type = 'target_playlist_match_refresh'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts >= max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Atomic snapshot publish function
--    Writes match_context + match_result[] in one transaction.
--    Returns the new context ID, or NULL if context_hash already exists (no-op).
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_existing_id UUID;
BEGIN
  -- Check for existing context with same hash (dedup / no-op)
  SELECT id INTO v_existing_id
  FROM match_context
  WHERE account_id = p_account_id AND context_hash = p_context_hash
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
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
