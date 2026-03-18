-- Rematch worker infrastructure: preference pointer, unique constraint, RPCs
-- Mirrors the enrichment worker pattern but for 'rematch' job type

ALTER TABLE user_preferences ADD COLUMN rematch_job_id UUID REFERENCES job(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_unique_active_rematch_per_account
  ON job (account_id)
  WHERE type = 'rematch' AND status IN ('pending', 'running');

CREATE INDEX idx_job_rematch_poll ON job(type, status, created_at)
  WHERE type = 'rematch' AND status = 'pending';

CREATE OR REPLACE FUNCTION claim_pending_rematch_job()
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
    WHERE type = 'rematch' AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION sweep_stale_rematch_jobs(stale_threshold INTERVAL)
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
    WHERE type = 'rematch'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts < max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION mark_dead_rematch_jobs(stale_threshold INTERVAL)
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
    WHERE type = 'rematch'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts >= max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
