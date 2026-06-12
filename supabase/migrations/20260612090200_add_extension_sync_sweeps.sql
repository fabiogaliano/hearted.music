-- Liveness sweeps for the worker-claimed extension_sync parent job.
--
-- Unlike the legacy inline sync_* phase jobs (which begin_extension_sync fails
-- outright on a 10-minute preflight), the parent is heartbeated by the worker,
-- so a crashed worker is recovered the same way library-processing jobs are:
-- requeue while attempts remain, dead-letter once exhausted. Re-running is safe
-- — every sync write is an idempotent upsert/diff.

CREATE OR REPLACE FUNCTION sweep_stale_extension_sync_jobs(stale_threshold INTERVAL)
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE job
  SET
    status = 'pending',
    started_at = NULL,
    heartbeat_at = NULL,
    updated_at = now()
  WHERE id IN (
    SELECT id FROM job
    WHERE type = 'extension_sync'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts < max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION mark_dead_extension_sync_jobs(stale_threshold INTERVAL)
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE job
  SET
    status = 'failed',
    completed_at = now(),
    error = 'max attempts exhausted after stale detection',
    updated_at = now()
  WHERE id IN (
    SELECT id FROM job
    WHERE type = 'extension_sync'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts >= max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- ---------------------------------------------------------------------------
-- claim_extension_sync_payload_cleanup — strips the payload pointer from
-- terminal extension_sync jobs and returns each path exactly once so the
-- worker can best-effort delete the Storage object.
--
-- Uses a FOR UPDATE SKIP LOCKED CTE to avoid races between concurrent sweep
-- ticks, captures the path before stripping it, and is idempotent (rows
-- without payload_path are ignored). Covers two orphan sources: the
-- begin_extension_sync self-heal (parent forced to failed while the runner
-- never ran), and any runner path where the best-effort Storage delete failed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_extension_sync_payload_cleanup()
RETURNS TABLE (job_id uuid, account_id uuid, payload_path text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id, job.account_id, progress->>'payload_path' AS payload_path
    FROM job
    WHERE type = 'extension_sync'
      AND status IN ('completed', 'failed')
      AND progress ? 'payload_path'
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE job
    SET progress   = progress - 'payload_path',
        updated_at = now()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING candidates.id, candidates.account_id, candidates.payload_path
  )
  SELECT id AS job_id, account_id, payload_path
  FROM updated;
$$;

REVOKE EXECUTE ON FUNCTION
  public.sweep_stale_extension_sync_jobs(INTERVAL),
  public.mark_dead_extension_sync_jobs(INTERVAL),
  public.claim_extension_sync_payload_cleanup()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.sweep_stale_extension_sync_jobs(INTERVAL),
  public.mark_dead_extension_sync_jobs(INTERVAL),
  public.claim_extension_sync_payload_cleanup()
TO service_role;
