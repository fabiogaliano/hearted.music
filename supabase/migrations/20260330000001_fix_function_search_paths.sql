-- Pin search_path on all SECURITY DEFINER functions to prevent search path injection.
-- Uses ALTER FUNCTION instead of recreating function bodies.

ALTER FUNCTION update_updated_at_column() SET search_path = public;
ALTER FUNCTION count_analyzed_songs_for_account(UUID) SET search_path = public;
ALTER FUNCTION get_liked_songs_page(UUID, TIMESTAMPTZ, INTEGER, TEXT) SET search_path = public;
ALTER FUNCTION get_liked_songs_stats(UUID) SET search_path = public;
ALTER FUNCTION claim_pending_rematch_job() SET search_path = public;
ALTER FUNCTION sweep_stale_rematch_jobs(INTERVAL) SET search_path = public;
ALTER FUNCTION mark_dead_rematch_jobs(INTERVAL) SET search_path = public;
ALTER FUNCTION claim_pending_lightweight_enrichment_job() SET search_path = public;
ALTER FUNCTION publish_match_snapshot(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB) SET search_path = public;
ALTER FUNCTION select_liked_song_ids_needing_pipeline_processing(UUID, INTEGER) SET search_path = public;
ALTER FUNCTION select_data_enriched_liked_song_ids(UUID) SET search_path = public;
ALTER FUNCTION claim_pending_library_processing_job() SET search_path = public;
ALTER FUNCTION sweep_stale_library_processing_jobs(INTERVAL) SET search_path = public;
ALTER FUNCTION mark_dead_library_processing_jobs(INTERVAL) SET search_path = public;
