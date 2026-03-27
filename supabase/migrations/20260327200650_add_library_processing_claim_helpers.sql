-- Library-processing claim, sweep, and dead-letter RPCs.
-- Runs after match_snapshot_refresh enum value is committed.

-- Unified mixed-workflow claim RPC: claims the highest-priority pending
-- enrichment or match_snapshot_refresh job.
-- Order: queue_priority DESC NULLS LAST, created_at ASC.
CREATE OR REPLACE FUNCTION claim_pending_library_processing_job()
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
    WHERE type IN ('enrichment', 'match_snapshot_refresh')
      AND status = 'pending'
    ORDER BY queue_priority DESC NULLS LAST, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- Unified sweep for both library-processing job types
CREATE OR REPLACE FUNCTION sweep_stale_library_processing_jobs(stale_threshold INTERVAL)
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
    WHERE type IN ('enrichment', 'match_snapshot_refresh')
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts < max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- Unified dead-letter for both library-processing job types
CREATE OR REPLACE FUNCTION mark_dead_library_processing_jobs(stale_threshold INTERVAL)
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
    WHERE type IN ('enrichment', 'match_snapshot_refresh')
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts >= max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- Unique active match_snapshot_refresh per account
CREATE UNIQUE INDEX idx_unique_active_match_snapshot_refresh_per_account
  ON job (account_id)
  WHERE type = 'match_snapshot_refresh' AND status IN ('pending', 'running');

-- Polling index for the mixed-workflow claim path
CREATE INDEX idx_job_library_processing_poll
  ON job(queue_priority DESC NULLS LAST, created_at ASC)
  WHERE type IN ('enrichment', 'match_snapshot_refresh') AND status = 'pending';
