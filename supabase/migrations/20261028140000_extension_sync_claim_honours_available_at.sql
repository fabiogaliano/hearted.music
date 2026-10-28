-- The extension-sync claim honours job.available_at, like
-- claim_pending_library_processing_job (20260625050000).
--
-- The worker now requeues an extension_sync parent after a transient DB error
-- with available_at pushed out by a backoff. Without this predicate the next
-- poll or job_created notification would reclaim it at once and spend the
-- retry budget inside the same outage. Every other row keeps the column's
-- now() default, so they stay claimable exactly as before.
--
-- Same signature and return type, so the running worker keeps calling it
-- unchanged; CREATE OR REPLACE keeps the existing grants.

CREATE OR REPLACE FUNCTION public.claim_pending_extension_sync_job()
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
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
    WHERE type = 'extension_sync'
      AND status = 'pending'
      AND available_at <= now()
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
