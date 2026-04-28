-- Stale / dead-letter recovery for walkthrough_match_preview jobs.
--
-- Without these, a worker crash that leaves a preview job in `running` cannot
-- be unstuck: the unique active-preview index means ensure() will keep
-- handing out the dead job's id instead of creating a fresh one, so the
-- onboarding session never gets another shot at compute before the UI
-- fallback wins.
--
-- Sibling functions to the library-processing recovery RPCs — kept separate
-- so the preview lifecycle can be reasoned about in isolation.

CREATE OR REPLACE FUNCTION sweep_stale_walkthrough_preview_jobs(stale_threshold INTERVAL)
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
    WHERE type = 'walkthrough_match_preview'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts < max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION mark_dead_walkthrough_preview_jobs(stale_threshold INTERVAL)
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
    WHERE type = 'walkthrough_match_preview'
      AND status = 'running'
      AND heartbeat_at < now() - stale_threshold
      AND attempts >= max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
