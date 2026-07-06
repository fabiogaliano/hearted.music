-- Composite indexes on match_result for the two per-subject query patterns.
--
-- getMatchPairsForPlaylist filters (snapshot_id, playlist_id) but the table
-- only has single-column indexes plus (snapshot_id, score DESC). The planner
-- picks idx_match_result_playlist_id, scans ~11k rows, and discards ~91% via
-- a filter on snapshot_id. At 3.3M rows (growing per snapshot) this degrades
-- linearly with history depth.
--
-- getMatchPairsForSong filters (snapshot_id, song_id). The existing partial
-- index idx_match_result_snapshot_rank covers (snapshot_id, song_id, rank)
-- WHERE rank IS NOT NULL — it cannot serve a general snapshot+song lookup.
--
-- Plain CREATE INDEX (not CONCURRENTLY): prod migrations run via
-- `supabase db push --linked`, which wraps each file in a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. A plain build
-- takes a SHARE lock on match_result for a few seconds, blocking only writes —
-- and those writes come from the background snapshot pipeline, not user
-- requests, so the brief block is acceptable. The IF NOT EXISTS guard keeps the
-- migration idempotent.

CREATE INDEX IF NOT EXISTS idx_match_result_snapshot_playlist
  ON public.match_result (snapshot_id, playlist_id);

CREATE INDEX IF NOT EXISTS idx_match_result_snapshot_song
  ON public.match_result (snapshot_id, song_id);
