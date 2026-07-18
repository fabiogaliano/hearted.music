-- Database time and a monotonic expiry prevent delayed heartbeat requests from shortening an active lease.
CREATE OR REPLACE FUNCTION public.heartbeat_audio_feature_backfill_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 900
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.audio_feature_backfill_job j
  SET lease_expires_at = GREATEST(
        COALESCE(j.lease_expires_at, now()),
        now() + make_interval(secs => p_lease_seconds)
      ),
      updated_at = now()
  WHERE j.id = p_job_id
    AND j.status = 'running'
    AND j.locked_by = p_worker_id;

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat_audio_feature_backfill_job(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_audio_feature_backfill_job(UUID, TEXT, INTEGER)
  TO service_role;
