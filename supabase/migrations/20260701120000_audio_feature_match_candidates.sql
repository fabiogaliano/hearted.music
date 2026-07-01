-- Persist the FULL scored candidate set behind every auto-search decision, not
-- just the outcome. Today the scorer computes a rich per-candidate breakdown
-- (video, score, reasons, reject reason) and it is thrown away: a low-confidence
-- job keeps only the "best score 0.63 below 0.75" string, and a successful review
-- keeps only the rejected subset. That leaves the operator unable to see WHICH
-- link scored what, and leaves no labeled corpus to tune the reject phrases /
-- weights / thresholds against (e.g. the Spanish "En Vivo" ≙ "Live" edge case).
--
-- Two homes, one JSON shape (MatchCandidateSnapshot[]):
--   audio_feature_backfill_job.candidates      — stuck jobs (low-confidence / no match)
--   audio_feature_source_review.candidates     — accepted / auto-approved matches
-- Both are additive JSONB DEFAULT '[]' columns: nothing existing reads them, so
-- this cannot affect the fenced settlement or the review queue.

ALTER TABLE audio_feature_backfill_job
  ADD COLUMN candidates JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE audio_feature_source_review
  ADD COLUMN candidates JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ===========================================================================
-- mark_..._manual_needed: carry the scored candidate set onto the stuck job.
-- ===========================================================================
-- Adding a param changes the signature, so this is a NEW overload rather than a
-- replace — drop the old 4-arg form first to avoid an ambiguous-function error on
-- named-arg calls that omit p_candidates.
DROP FUNCTION IF EXISTS mark_audio_feature_backfill_manual_needed(UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION mark_audio_feature_backfill_manual_needed(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_candidates JSONB DEFAULT '[]'::jsonb
)
RETURNS SETOF audio_feature_backfill_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE audio_feature_backfill_job
  SET status = 'manual_needed',
      completed_at = now(),
      lease_expires_at = NULL,
      error_code = p_error_code,
      error_message = p_error_message,
      candidates = COALESCE(p_candidates, '[]'::jsonb),
      updated_at = now()
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id
  RETURNING *;
$$;

GRANT EXECUTE ON FUNCTION mark_audio_feature_backfill_manual_needed(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ===========================================================================
-- settle_..._job: persist the scored candidate set on the review it inserts.
-- ===========================================================================
-- Same overload concern — drop the 21-arg form, recreate with the trailing
-- p_candidates. Body is unchanged except the review INSERT now also writes
-- `candidates`; the fence, upsert, and skip logic are identical.
DROP FUNCTION IF EXISTS settle_audio_feature_backfill_job(
  UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER,
  TEXT, TEXT, INTEGER, REAL, JSONB, JSONB, REAL[], JSONB, JSONB
);

CREATE FUNCTION settle_audio_feature_backfill_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_song_id UUID,
  p_source_type TEXT,
  p_features JSONB,
  p_review_status TEXT,
  p_reviewed_by TEXT DEFAULT NULL,
  p_youtube_video_id TEXT DEFAULT NULL,
  p_youtube_url TEXT DEFAULT NULL,
  p_youtube_title TEXT DEFAULT NULL,
  p_youtube_channel TEXT DEFAULT NULL,
  p_youtube_duration_seconds INTEGER DEFAULT NULL,
  p_youtube_thumbnail_url TEXT DEFAULT NULL,
  p_search_query TEXT DEFAULT NULL,
  p_candidate_rank INTEGER DEFAULT NULL,
  p_match_score REAL DEFAULT NULL,
  p_match_reasons JSONB DEFAULT NULL,
  p_rejected_candidates JSONB DEFAULT NULL,
  p_clip_starts_seconds REAL[] DEFAULT NULL,
  p_clip_features JSONB DEFAULT NULL,
  p_aggregation_metadata JSONB DEFAULT NULL,
  p_candidates JSONB DEFAULT NULL
)
RETURNS TABLE(job_id uuid, audio_feature_id uuid, review_id uuid, did_skip boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_song_id UUID;
  v_source_type TEXT;
  v_existing UUID;
  v_feature_id UUID;
  v_review_id UUID;
BEGIN
  -- Fence + row lock: a concurrent cancel/obsolete/sweep can't slip in between the
  -- check and the writes. A non-matching row (cancelled, superseded, wrong worker)
  -- yields zero rows. We read song_id/source_type straight off the locked row and
  -- treat those as authoritative below, so the RPC never writes based on a
  -- caller-provided copy of them.
  SELECT j.song_id, j.source_type INTO v_song_id, v_source_type
  FROM audio_feature_backfill_job j
  WHERE j.id = p_job_id AND j.status = 'running' AND j.locked_by = p_worker_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- The caller passes the claimed job's own song/source, so a mismatch is an
  -- inconsistent call. Refuse to write (like a rejected fence) rather than risk
  -- persisting features against the wrong song.
  IF p_song_id IS DISTINCT FROM v_song_id
     OR p_source_type IS DISTINCT FROM v_source_type THEN
    RETURN;
  END IF;

  -- youtube_url is an explicit operator replacement and may overwrite, so it
  -- upserts (DO UPDATE) and always gets a row back. youtube_search must NEVER
  -- clobber a feature that exists OR lands concurrently (catalog, or a manual
  -- replacement) between any check and this write, so it inserts DO NOTHING — the
  -- only race-free guard. No row back means a feature already won the slot, so we
  -- complete as a skip without writing a feature or a review.
  IF v_source_type = 'youtube_url' THEN
    INSERT INTO song_audio_feature (
      song_id, acousticness, danceability, energy, instrumentalness, liveness,
      loudness, speechiness, tempo, valence, key, mode, time_signature
    )
    VALUES (
      v_song_id,
      (p_features->>'acousticness')::REAL,
      (p_features->>'danceability')::REAL,
      (p_features->>'energy')::REAL,
      (p_features->>'instrumentalness')::REAL,
      (p_features->>'liveness')::REAL,
      (p_features->>'loudness')::REAL,
      (p_features->>'speechiness')::REAL,
      (p_features->>'tempo')::REAL,
      (p_features->>'valence')::REAL,
      NULL, NULL, NULL
    )
    ON CONFLICT (song_id) DO UPDATE SET
      acousticness = EXCLUDED.acousticness,
      danceability = EXCLUDED.danceability,
      energy = EXCLUDED.energy,
      instrumentalness = EXCLUDED.instrumentalness,
      liveness = EXCLUDED.liveness,
      loudness = EXCLUDED.loudness,
      speechiness = EXCLUDED.speechiness,
      tempo = EXCLUDED.tempo,
      valence = EXCLUDED.valence,
      key = EXCLUDED.key,
      mode = EXCLUDED.mode,
      time_signature = EXCLUDED.time_signature,
      updated_at = now()
    RETURNING id INTO v_feature_id;
  ELSE
    INSERT INTO song_audio_feature (
      song_id, acousticness, danceability, energy, instrumentalness, liveness,
      loudness, speechiness, tempo, valence, key, mode, time_signature
    )
    VALUES (
      v_song_id,
      (p_features->>'acousticness')::REAL,
      (p_features->>'danceability')::REAL,
      (p_features->>'energy')::REAL,
      (p_features->>'instrumentalness')::REAL,
      (p_features->>'liveness')::REAL,
      (p_features->>'loudness')::REAL,
      (p_features->>'speechiness')::REAL,
      (p_features->>'tempo')::REAL,
      (p_features->>'valence')::REAL,
      NULL, NULL, NULL
    )
    ON CONFLICT (song_id) DO NOTHING
    RETURNING id INTO v_feature_id;

    IF v_feature_id IS NULL THEN
      SELECT saf.id INTO v_existing
      FROM song_audio_feature saf
      WHERE saf.song_id = v_song_id;
      UPDATE audio_feature_backfill_job
      SET status = 'completed', completed_at = now(),
          lease_expires_at = NULL, updated_at = now()
      WHERE id = p_job_id;
      RETURN QUERY SELECT p_job_id, v_existing, NULL::UUID, TRUE;
      RETURN;
    END IF;
  END IF;

  INSERT INTO audio_feature_source_review (
    song_id, audio_feature_id, backfill_job_id, source_type,
    youtube_video_id, youtube_url, youtube_title, youtube_channel,
    youtube_duration_seconds, youtube_thumbnail_url,
    search_query, candidate_rank, match_score, match_reasons, rejected_candidates,
    candidates,
    clip_starts_seconds, clip_features, averaged_features, aggregation_metadata,
    status, reviewed_by, reviewed_at
  )
  VALUES (
    v_song_id, v_feature_id, p_job_id, v_source_type,
    p_youtube_video_id, p_youtube_url, p_youtube_title, p_youtube_channel,
    p_youtube_duration_seconds, p_youtube_thumbnail_url,
    p_search_query, p_candidate_rank, p_match_score,
    COALESCE(p_match_reasons, '[]'::jsonb), COALESCE(p_rejected_candidates, '[]'::jsonb),
    COALESCE(p_candidates, '[]'::jsonb),
    p_clip_starts_seconds, p_clip_features, p_features,
    COALESCE(p_aggregation_metadata, '{}'::jsonb),
    p_review_status, p_reviewed_by,
    CASE WHEN p_review_status = 'approved' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_review_id;

  UPDATE audio_feature_backfill_job
  SET status = 'completed', completed_at = now(),
      lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id;

  RETURN QUERY SELECT p_job_id, v_feature_id, v_review_id, FALSE;
END;
$function$;

GRANT EXECUTE ON FUNCTION settle_audio_feature_backfill_job(
  UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER,
  TEXT, TEXT, INTEGER, REAL, JSONB, JSONB, REAL[], JSONB, JSONB, JSONB
) TO service_role;
