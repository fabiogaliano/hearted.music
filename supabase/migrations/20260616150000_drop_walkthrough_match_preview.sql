-- Retire the walkthrough match-preview subsystem.
--
-- The fake-demo-first onboarding (see claudedocs/onboarding-restructure.md, phase 5)
-- makes the walkthrough match reveal run entirely on canned data, so this
-- background workflow — which scored a chosen demo song against the user's real
-- target playlists — no longer has any producer or consumer. This drops its
-- dedicated table, status enum, claim/recovery RPCs, the partial unique index on
-- job, and the now-unreachable `walkthrough_match_preview` value from job_type.
--
-- Postgres can't drop an enum value in place, so job_type is recreated without
-- it. Only job.type uses the enum and no function takes/returns it, but several
-- partial indexes on job bind job_type literals in their predicates, so they are
-- dropped before the swap and recreated verbatim after (all except the
-- walkthrough one, which is gone for good).

-- No active or historical preview jobs are expected, but clear defensively so a
-- stray row cannot block the enum recreation below.
DELETE FROM job WHERE type = 'walkthrough_match_preview';

-- Dedicated claim + recovery RPCs (siblings of the library-processing ones).
DROP FUNCTION IF EXISTS claim_pending_walkthrough_preview_job();
DROP FUNCTION IF EXISTS sweep_stale_walkthrough_preview_jobs(INTERVAL);
DROP FUNCTION IF EXISTS mark_dead_walkthrough_preview_jobs(INTERVAL);

-- Preview results table (drops its trigger + index with it) and its status enum.
DROP TABLE IF EXISTS walkthrough_match_preview;
DROP TYPE IF EXISTS walkthrough_preview_status;

-- All partial indexes on job whose predicates reference a job_type literal must
-- be dropped before the enum is recreated; the column rebuild otherwise fails
-- with "operator does not exist: job_type = job_type_old".
DROP INDEX IF EXISTS idx_unique_active_walkthrough_preview_per_account;
DROP INDEX IF EXISTS idx_job_extension_sync_poll;
DROP INDEX IF EXISTS idx_job_library_processing_poll;
DROP INDEX IF EXISTS idx_job_lightweight_enrichment_poll;
DROP INDEX IF EXISTS idx_job_rematch_poll;
DROP INDEX IF EXISTS idx_unique_active_enrichment_per_account;
DROP INDEX IF EXISTS idx_unique_active_lightweight_enrichment_per_account;
DROP INDEX IF EXISTS idx_unique_active_match_snapshot_refresh_per_account;
DROP INDEX IF EXISTS idx_unique_active_rematch_per_account;
DROP INDEX IF EXISTS idx_unique_active_sync_per_account;
DROP INDEX IF EXISTS idx_unique_active_target_playlist_match_refresh_per_account;

-- Recreate job_type without 'walkthrough_match_preview'.
ALTER TYPE job_type RENAME TO job_type_old;
CREATE TYPE job_type AS ENUM (
  'sync_liked_songs',
  'sync_playlists',
  'song_analysis',
  'playlist_analysis',
  'matching',
  'sync_playlist_tracks',
  'audio_features',
  'song_embedding',
  'playlist_profiling',
  'genre_tagging',
  'enrichment',
  'rematch',
  'playlist_lightweight_enrichment',
  'target_playlist_match_refresh',
  'match_snapshot_refresh',
  'extension_sync'
);
ALTER TABLE job ALTER COLUMN type TYPE job_type USING type::text::job_type;
DROP TYPE job_type_old;

-- Recreate the surviving partial indexes verbatim (every job_type-predicate
-- index except the dropped walkthrough one).
CREATE INDEX idx_job_extension_sync_poll ON public.job USING btree (created_at) WHERE ((type = 'extension_sync'::job_type) AND (status = 'pending'::job_status));
CREATE INDEX idx_job_library_processing_poll ON public.job USING btree (queue_priority DESC NULLS LAST, created_at) WHERE ((type = ANY (ARRAY['enrichment'::job_type, 'match_snapshot_refresh'::job_type])) AND (status = 'pending'::job_status));
CREATE INDEX idx_job_lightweight_enrichment_poll ON public.job USING btree (type, status, created_at) WHERE ((type = 'playlist_lightweight_enrichment'::job_type) AND (status = 'pending'::job_status));
CREATE INDEX idx_job_rematch_poll ON public.job USING btree (type, status, created_at) WHERE ((type = 'rematch'::job_type) AND (status = 'pending'::job_status));
CREATE UNIQUE INDEX idx_unique_active_enrichment_per_account ON public.job USING btree (account_id) WHERE ((type = 'enrichment'::job_type) AND (status = ANY (ARRAY['pending'::job_status, 'running'::job_status])));
CREATE UNIQUE INDEX idx_unique_active_lightweight_enrichment_per_account ON public.job USING btree (account_id) WHERE ((type = 'playlist_lightweight_enrichment'::job_type) AND (status = ANY (ARRAY['pending'::job_status, 'running'::job_status])));
CREATE UNIQUE INDEX idx_unique_active_match_snapshot_refresh_per_account ON public.job USING btree (account_id) WHERE ((type = 'match_snapshot_refresh'::job_type) AND (status = ANY (ARRAY['pending'::job_status, 'running'::job_status])));
CREATE UNIQUE INDEX idx_unique_active_rematch_per_account ON public.job USING btree (account_id) WHERE ((type = 'rematch'::job_type) AND (status = ANY (ARRAY['pending'::job_status, 'running'::job_status])));
CREATE UNIQUE INDEX idx_unique_active_sync_per_account ON public.job USING btree (account_id) WHERE ((type = 'sync_liked_songs'::job_type) AND (status = ANY (ARRAY['pending'::job_status, 'running'::job_status])));
CREATE UNIQUE INDEX idx_unique_active_target_playlist_match_refresh_per_account ON public.job USING btree (account_id) WHERE ((type = 'target_playlist_match_refresh'::job_type) AND (status = ANY (ARRAY['pending'::job_status, 'running'::job_status])));
