-- Lightweight enrichment worker infrastructure
-- At most one active job per account, atomic claim for worker polling

CREATE UNIQUE INDEX idx_unique_active_lightweight_enrichment_per_account
  ON job (account_id)
  WHERE type = 'playlist_lightweight_enrichment' AND status IN ('pending', 'running');

CREATE INDEX idx_job_lightweight_enrichment_poll ON job(type, status, created_at)
  WHERE type = 'playlist_lightweight_enrichment' AND status = 'pending';

CREATE OR REPLACE FUNCTION claim_pending_lightweight_enrichment_job()
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
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
    WHERE type = 'playlist_lightweight_enrichment' AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
