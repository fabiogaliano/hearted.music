-- MSR-08: Match preference and job availability schema.
--
-- Two independent schema additions:
--
-- 1. user_preferences.match_view_mode — persists the user's last selected
--    match orientation toggle so non-/match surfaces (e.g. sidebar) can
--    restore the preferred mode. Defaults to 'song' so existing users get
--    song mode behaviour unchanged (C10).
--
-- 2. job.available_at — scheduling column for deferred job claiming. Defaults
--    to now() so every existing and new job is immediately claimable unless
--    explicitly deferred (C16). The debounce/ensure logic that sets future
--    values lands in MSR-09; this story only wires the schema.

-- ---------------------------------------------------------------------------
-- 1. user_preferences.match_view_mode (C10)
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_preferences
  ADD COLUMN match_view_mode TEXT NOT NULL DEFAULT 'song'
    CONSTRAINT user_preferences_match_view_mode_check
      CHECK (match_view_mode IN ('song', 'playlist'));

-- ---------------------------------------------------------------------------
-- 2. job.available_at (C16)
-- ---------------------------------------------------------------------------

ALTER TABLE public.job
  ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Replace the library-processing poll index so it covers available_at.
-- The claim RPC filters available_at <= now(), so leading with available_at
-- lets the planner range-scan only the ready slice before sorting by priority.
DROP INDEX IF EXISTS public.idx_job_library_processing_poll;

CREATE INDEX idx_job_library_processing_poll
  ON public.job (available_at ASC, queue_priority DESC NULLS LAST, created_at ASC)
  WHERE type IN ('enrichment', 'match_snapshot_refresh')
    AND status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. Update claim RPC to gate on available_at (minimal/compat; E16 deferred)
-- ---------------------------------------------------------------------------
-- Adding available_at <= now() is the only predicate change. The function
-- signature, return type, and all callers are unchanged.

CREATE OR REPLACE FUNCTION public.claim_pending_library_processing_job()
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
    WHERE type IN ('enrichment', 'match_snapshot_refresh')
      AND status = 'pending'
      AND available_at <= now()
    ORDER BY queue_priority DESC NULLS LAST, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_library_processing_job()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_pending_library_processing_job()
TO service_role;
