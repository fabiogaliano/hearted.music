-- Mark the optional settle params as DEFAULT NULL so they generate as optional
-- args. They were always optional in practice: a manual youtube_url replacement
-- has no search_query/candidate_rank/match_score (no search ran), an automatic
-- youtube_search review has no reviewed_by yet (pending), and YouTube metadata
-- (channel/duration/thumbnail) is often absent. The original signature omitted
-- defaults, so the type generator (which marks function primitives non-nullable)
-- forced callers to pass non-null. Callers now pass `undefined` for absent values,
-- which omits the arg and lets the default supply NULL — the exact row written
-- before. Postgres requires trailing defaults, so every param from the first
-- optional one onward (p_reviewed_by) gets DEFAULT NULL; p_youtube_url is always
-- passed in practice and its default is never used.

CREATE OR REPLACE FUNCTION settle_audio_feature_backfill_job(
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
  p_aggregation_metadata JSONB DEFAULT NULL
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
    clip_starts_seconds, clip_features, averaged_features, aggregation_metadata,
    status, reviewed_by, reviewed_at
  )
  VALUES (
    v_song_id, v_feature_id, p_job_id, v_source_type,
    p_youtube_video_id, p_youtube_url, p_youtube_title, p_youtube_channel,
    p_youtube_duration_seconds, p_youtube_thumbnail_url,
    p_search_query, p_candidate_rank, p_match_score,
    COALESCE(p_match_reasons, '[]'::jsonb), COALESCE(p_rejected_candidates, '[]'::jsonb),
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
$function$
