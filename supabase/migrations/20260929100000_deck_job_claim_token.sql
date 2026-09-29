-- Deck-job settlement fence (expand-only).
--
-- complete/defer/heartbeat were guarded only by status = 'running'. Once
-- sweep_stale_match_review_deck_jobs re-pends a stalled job and another worker
-- reclaims it, the row is 'running' again, so the stalled worker's late settle
-- or heartbeat landed on the new run: completing it mid-flight (breaking the
-- per-(account, orientation) serialization the claim's NOT EXISTS gate relies
-- on) or keeping its lease alive.
--
-- Fix mirrors audio_feature_backfill_job's locked_by fence, but the value is a
-- fresh token per claim rather than a worker id: a restarted container reuses
-- hostname and pid, so a worker id cannot tell a stale run from a new one.
-- Settlement stays a direct UPDATE in deck-jobs.ts, now also matching
-- locked_by.
--
-- Rolling deploy: CI applies this before the worker deploy. Old worker code
-- keeps working against it (claim signature unchanged, the extra returned
-- column is ignored, its status-only settles still match), so only the old
-- process's own overlap window keeps the old race until it drains. Rows
-- claimed before this migration have locked_by NULL; only the old worker
-- settles those, and the sweep re-pends them if it never does.

ALTER TABLE public.match_review_deck_job
  ADD COLUMN locked_by TEXT;

-- Full body restated from 20260706000011; only the locked_by assignment is new.
CREATE OR REPLACE FUNCTION public.claim_pending_match_review_deck_job(
  p_limit INTEGER DEFAULT 1
)
RETURNS SETOF public.match_review_deck_job
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT j.id
    FROM public.match_review_deck_job j
    WHERE j.status = 'pending'
      AND j.available_at <= now()
      AND j.attempts < j.max_attempts
      AND NOT EXISTS (
        SELECT 1
        FROM public.match_review_deck_job running_job
        WHERE running_job.account_id = j.account_id
          AND running_job.orientation = j.orientation
          AND running_job.status = 'running'
      )
    ORDER BY
      CASE j.kind
        WHEN 'capture_ahead' THEN 0
        WHEN 'append_sessions' THEN 1
        WHEN 'build_proposals' THEN 2
        WHEN 'repair' THEN 2
        ELSE 3
      END ASC,
      j.available_at ASC,
      j.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.match_review_deck_job j
  SET status = 'running',
      attempts = attempts + 1,
      heartbeat_at = now(),
      locked_by = gen_random_uuid()::text,
      updated_at = now()
  FROM claimed
  WHERE j.id = claimed.id
  RETURNING j.*;
END;
$$;

-- Full body restated from 20260706000006; only the locked_by reset is new.
CREATE OR REPLACE FUNCTION public.sweep_stale_match_review_deck_jobs(
  p_lease_seconds INTEGER DEFAULT 900
)
RETURNS SETOF public.match_review_deck_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.match_review_deck_job j
  SET status = 'pending',
      available_at = now(),
      heartbeat_at = NULL,
      locked_by = NULL,
      updated_at = now()
  WHERE j.id IN (
    SELECT id FROM public.match_review_deck_job
    WHERE status = 'running'
      AND heartbeat_at IS NOT NULL
      AND heartbeat_at < now() - make_interval(secs => p_lease_seconds)
      AND attempts < max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_match_review_deck_job(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sweep_stale_match_review_deck_jobs(INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_pending_match_review_deck_job(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_stale_match_review_deck_jobs(INTEGER)
  TO service_role;
