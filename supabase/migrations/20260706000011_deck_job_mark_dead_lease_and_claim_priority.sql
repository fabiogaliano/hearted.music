-- Deck read-model review fixes H1 + M2 (claudedocs/deck-read-model-review-
-- consolidated.md). Both redefine functions from 20260706000006; each
-- CREATE OR REPLACE restates the full prior body with only the targeted
-- lines changed, per migration convention.

-- ---------------------------------------------------------------------------
-- H1: mark_dead_match_review_deck_jobs must not dead-letter a job that is
-- still genuinely running.
-- ---------------------------------------------------------------------------
-- `attempts` is incremented at claim time, so a job on its final attempt
-- satisfies `attempts >= max_attempts` the instant it starts running — the
-- old predicate (`status IN ('pending','running') AND attempts >=
-- max_attempts`, ignoring heartbeat_at) let a sweep tick mark it 'dead'
-- mid-flight. claim_pending_…'s NOT EXISTS gate only checks status =
-- 'running', so a second job for the same (account_id, orientation) could
-- then be claimed while the first was still executing — breaking the
-- per-(account, orientation) serialization guarantee.
--
-- Fix: only dead-letter a 'running' job once its lease has actually expired
-- (same heartbeat-staleness test sweep_stale_match_review_deck_jobs uses),
-- via a new p_lease_seconds parameter mirroring sweep's signature/default.
-- 'pending' jobs have no heartbeat to go stale, so they dead-letter as before.
--
-- The signature gains a parameter, so the old zero-arg overload is dropped
-- first — otherwise both would coexist and RPC callers with no args would be
-- ambiguous to resolve.
DROP FUNCTION IF EXISTS public.mark_dead_match_review_deck_jobs();

CREATE OR REPLACE FUNCTION public.mark_dead_match_review_deck_jobs(
  p_lease_seconds INTEGER DEFAULT 900
)
RETURNS SETOF public.match_review_deck_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.match_review_deck_job j
  SET status = 'dead',
      updated_at = now()
  WHERE j.id IN (
    SELECT id FROM public.match_review_deck_job
    WHERE attempts >= max_attempts
      AND (
        status = 'pending'
        OR (
          status = 'running'
          AND heartbeat_at < now() - make_interval(secs => p_lease_seconds)
        )
      )
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
$$;

-- ---------------------------------------------------------------------------
-- M2: claim priority so capture_ahead isn't starved behind a build flood.
-- ---------------------------------------------------------------------------
-- The warm script floods build_proposals for every account; without a
-- job-kind priority those queue ahead of a live swiper's capture_ahead jobs
-- on plain available_at/created_at FIFO ordering, defeating "capture runs
-- ahead of the user". Add kind priority as the first ORDER BY key; everything
-- else (FOR UPDATE SKIP LOCKED, the NOT EXISTS running-gate, the attempts
-- increment, the returned columns) is unchanged from 20260706000006.
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
      updated_at = now()
  FROM claimed
  WHERE j.id = claimed.id
  RETURNING j.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_dead_match_review_deck_jobs(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pending_match_review_deck_job(INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_dead_match_review_deck_jobs(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pending_match_review_deck_job(INTEGER)
  TO service_role;
