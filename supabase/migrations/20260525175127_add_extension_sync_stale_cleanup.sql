-- Self-healing cleanup for orphaned extension sync jobs.
--
-- Unlike enrichment / match_snapshot_refresh, the three sync_* phase jobs are
-- inline request work created by POST /api/extension/sync. They are never
-- worker-claimed and have no heartbeat, so the existing sweep RPCs do not
-- cover them. When a sync request returns early or throws after creating the
-- phase jobs, sibling rows can be stranded in 'pending'/'running' forever,
-- which makes getActiveSync() return non-null permanently and turns every
-- future sync into a 429.
--
-- Sweeping these back to 'pending' is meaningless (no worker claims them), so
-- the safe self-healing action is to FAIL stale rows. Scoped to one account so
-- a sync request can run it as a cheap preflight without touching other users.
CREATE OR REPLACE FUNCTION mark_stale_extension_sync_jobs(
  p_account_id UUID,
  p_stale_threshold INTERVAL
)
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
AS $$
  UPDATE job
  SET
    status = 'failed',
    completed_at = now(),
    error = 'stale sync job cleaned up before new sync attempt',
    updated_at = now()
  WHERE id IN (
    SELECT id FROM job
    WHERE account_id = p_account_id
      AND type IN ('sync_liked_songs', 'sync_playlists', 'sync_playlist_tracks')
      AND status IN ('pending', 'running')
      AND coalesce(started_at, created_at) < now() - p_stale_threshold
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
