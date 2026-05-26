-- P1-3: index foreign-key columns that are ON DELETE CASCADE targets.
--
-- `song` is a shared catalog table and `playlist` is per-account; many tables
-- cascade-delete from them. Postgres does not auto-index the referencing side,
-- so deleting a parent row scans these children sequentially and holds locks
-- for the duration of the cascade. Index the cascade-target FK columns that
-- have no usable leading index today.
--
-- Note: plain CREATE INDEX (not CONCURRENTLY) because the Supabase CLI wraps
-- each migration in a transaction and these tables are tiny at launch. If this
-- is ever applied to a large production table, split it into a non-transactional
-- migration using CREATE INDEX CONCURRENTLY.

create index if not exists idx_match_decision_playlist
	on match_decision (playlist_id);

create index if not exists idx_match_decision_song_only
	on match_decision (song_id);

create index if not exists idx_account_song_unlock_song
	on account_song_unlock (song_id);

create index if not exists idx_song_failure_compensation_song
	on song_failure_compensation (song_id);
