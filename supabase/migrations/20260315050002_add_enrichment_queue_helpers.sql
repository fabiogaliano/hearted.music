-- Queue helper functions for the background enrichment worker
-- Uses advisory locking and SKIP LOCKED for safe concurrent job claiming

CREATE OR REPLACE FUNCTION claim_pending_enrichment_job()
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
    WHERE type = 'enrichment' AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION sweep_stale_enrichment_jobs(stale_threshold INTERVAL)
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
    WHERE type = 'enrichment'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts < max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION mark_dead_enrichment_jobs(stale_threshold INTERVAL)
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
    WHERE type = 'enrichment'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts >= max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
