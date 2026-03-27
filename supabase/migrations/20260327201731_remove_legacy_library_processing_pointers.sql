-- Remove legacy orchestration pointer columns from user_preferences.
-- Library-processing state is now the sole source of truth for active jobs.

ALTER TABLE user_preferences DROP COLUMN IF EXISTS enrichment_job_id;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS target_playlist_match_refresh_job_id;

-- Drop old type-specific claim/sweep/dead-letter RPCs replaced by unified library-processing versions.
DROP FUNCTION IF EXISTS claim_pending_enrichment_job();
DROP FUNCTION IF EXISTS sweep_stale_enrichment_jobs(INTERVAL);
DROP FUNCTION IF EXISTS mark_dead_enrichment_jobs(INTERVAL);
DROP FUNCTION IF EXISTS claim_pending_target_playlist_match_refresh_job();
DROP FUNCTION IF EXISTS sweep_stale_target_playlist_match_refresh_jobs(INTERVAL);
DROP FUNCTION IF EXISTS mark_dead_target_playlist_match_refresh_jobs(INTERVAL);

-- Drop old type-specific polling indexes replaced by unified library-processing index.
DROP INDEX IF EXISTS idx_job_enrichment_poll;
DROP INDEX IF EXISTS idx_job_target_playlist_match_refresh_poll;

-- Leave old enum values ('rematch', 'playlist_lightweight_enrichment', 'target_playlist_match_refresh')
-- inert since PostgreSQL makes enum value deletion risky.
