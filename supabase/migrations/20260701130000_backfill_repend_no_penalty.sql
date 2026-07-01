-- Re-queue a claimed backfill job WITHOUT consuming a retry attempt and WITHOUT
-- ever terminalizing it. For failures where the worker did zero song-specific work
-- and the cause is guaranteed-transient.
--
-- Motivation: defer_audio_feature_backfill_job counts every failure against
-- max_attempts and flips the job to 'failed' (→ audio_feature_state =
-- 'unavailable_terminal') once the budget is spent. That budget is meant for
-- song/video problems (removed video, unusable audio). Infra contention is not the
-- song's fault, so charging it there let the 2026-06-27 DB-overload incident
-- permanently terminalize 19 perfectly-good songs via provider_busy alone.
--
-- The only caller today is the provider_busy path: the worker couldn't acquire the
-- ReccoBeats file-analysis lease. That lease has a 600s TTL, so contention ALWAYS
-- clears — there is no permanent-stranding risk from retrying forever. attempts is
-- decremented (floored at 0) to undo the claim's increment, so a burst of lease
-- contention can't silently poison the budget for a later, genuine per-song error.
CREATE OR REPLACE FUNCTION repend_audio_feature_backfill_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_retry_seconds INTEGER,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS SETOF audio_feature_backfill_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE audio_feature_backfill_job
  SET status = 'pending',
      attempts = GREATEST(0, attempts - 1),
      not_before = now() + make_interval(secs => p_retry_seconds),
      completed_at = NULL,
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      error_code = p_error_code,
      error_message = p_error_message,
      updated_at = now()
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id
  RETURNING *;
$$;

GRANT EXECUTE ON FUNCTION repend_audio_feature_backfill_job(UUID, TEXT, INTEGER, TEXT, TEXT) TO service_role;
