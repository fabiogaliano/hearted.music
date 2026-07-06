-- Match deck read model, Phase 1a (plan §5.3): deck-job claim/sweep/dead
-- functions. Modeled on claim_pending_audio_feature_backfill_job /
-- sweep_stale_audio_feature_backfill_jobs, with one addition the precedent
-- doesn't need: claiming must skip any row whose (account_id, orientation)
-- already has a running deck job — that NOT EXISTS check is the
-- per-account+orientation serialization guarantee the plan requires (§5.3,
-- §6), since publish/filter-change/append/capture-ahead jobs for the same
-- account+orientation must never run concurrently and race each other.
--
-- Unlike the audio_feature precedent, mark-dead is NOT folded into sweep —
-- it is its own function here because the orchestration spec asked for three
-- separate deck-job functions. sweep only reclaims running->pending on a
-- stale heartbeat when attempts remain; mark_dead independently terminates
-- any pending/running job that has exhausted max_attempts, regardless of
-- heartbeat staleness.

-- ---------------------------------------------------------------------------
-- claim_pending_match_review_deck_job
-- ---------------------------------------------------------------------------
-- Leases up to p_limit pending jobs whose available_at has passed, skipping
-- any job whose (account_id, orientation) already has a running job. Note:
-- with p_limit > 1 in a single call, two pending jobs for the same
-- account+orientation could both be selected in one statement (the NOT
-- EXISTS check only sees committed 'running' rows, not sibling rows being
-- claimed in the same UPDATE) — safe at the default p_limit = 1 a poller
-- would use; batching hardening is deferred to the worker-integration phase
-- that actually calls this with p_limit > 1.
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
    ORDER BY j.available_at ASC, j.created_at ASC
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

-- ---------------------------------------------------------------------------
-- sweep_stale_match_review_deck_jobs
-- ---------------------------------------------------------------------------
-- Reclaims running jobs whose heartbeat is older than the lease back to
-- pending, so a crashed/killed worker doesn't wedge its (account, orientation)
-- in a permanently "running" state. Jobs that have exhausted max_attempts are
-- left alone here — mark_dead_match_review_deck_jobs handles those.
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

-- ---------------------------------------------------------------------------
-- mark_dead_match_review_deck_jobs
-- ---------------------------------------------------------------------------
-- Terminates any job (pending or running, e.g. a stale-heartbeat job sweep
-- deliberately left alone) that has exhausted max_attempts. 'dead' is the
-- terminal status (alongside 'completed') per the table's CHECK constraint.
CREATE OR REPLACE FUNCTION public.mark_dead_match_review_deck_jobs()
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
    WHERE status IN ('pending', 'running')
      AND attempts >= max_attempts
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_match_review_deck_job(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sweep_stale_match_review_deck_jobs(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_dead_match_review_deck_jobs()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_pending_match_review_deck_job(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_stale_match_review_deck_jobs(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_dead_match_review_deck_jobs()
  TO service_role;
