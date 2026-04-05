-- S3-07: Liked songs page locked/pending split with entitlement filtering
-- Depends on: S1-01 (account_song_unlock), S1-04 (entitlement predicate), S2-01 (SongDisplayState)
--
-- Updates get_liked_songs_page to:
-- 1. Return display_state (locked/pending/analyzing/analyzed/failed) per song
-- 2. Suppress analysis content for non-entitled (locked) songs
-- 3. Fix p_filter='pending' to exclude locked songs

DROP FUNCTION IF EXISTS get_liked_songs_page(UUID, TIMESTAMPTZ, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION get_liked_songs_page(
  p_account_id UUID,
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_filter TEXT DEFAULT 'all'
)
RETURNS TABLE (
  id UUID,
  liked_at TIMESTAMPTZ,
  matching_status TEXT,
  display_state TEXT,
  song_id UUID,
  song_spotify_id TEXT,
  song_name TEXT,
  song_artists TEXT[],
  song_artist_ids TEXT[],
  song_album_name TEXT,
  song_image_url TEXT,
  song_genres TEXT[],
  artist_image_url TEXT,
  analysis_id UUID,
  analysis_content JSONB,
  analysis_model TEXT,
  analysis_created_at TIMESTAMPTZ,
  audio_tempo REAL,
  audio_energy REAL,
  audio_valence REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_snapshot_id UUID;
BEGIN
  SELECT ms.id INTO v_latest_snapshot_id
  FROM match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
  LIMIT 1;

  RETURN QUERY
  WITH billing_facts AS (
    SELECT COALESCE(
      (
        SELECT
          ab.unlimited_access_source IS NOT NULL
          AND (
            ab.unlimited_access_source = 'self_hosted'
            OR (
              ab.unlimited_access_source = 'subscription'
              AND ab.subscription_status = 'active'
            )
          )
        FROM account_billing ab
        WHERE ab.account_id = p_account_id
      ),
      false
    ) AS has_unlimited_access
  ),
  entitled_songs AS (
    SELECT
      ls2.song_id,
      (
        bf.has_unlimited_access
        OR EXISTS (
          SELECT 1 FROM account_song_unlock asu
          WHERE asu.account_id = p_account_id
            AND asu.song_id = ls2.song_id
            AND asu.revoked_at IS NULL
        )
      ) AS is_entitled
    FROM liked_song ls2
    CROSS JOIN billing_facts bf
    WHERE ls2.account_id = p_account_id
      AND ls2.unliked_at IS NULL
  )
  SELECT
    ls.id,
    ls.liked_at,

    -- matching_status: NULL for locked songs
    CASE
      WHEN NOT ent.is_entitled THEN NULL
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count > 0 THEN 'has_suggestions'
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count = 0 THEN 'acted'
      WHEN ist.id IS NOT NULL THEN 'no_suggestions'
      ELSE 'pending'
    END AS matching_status,

    -- display_state: locked/pending/analyzed/failed
    CASE
      WHEN NOT ent.is_entitled THEN 'locked'
      WHEN sa.id IS NOT NULL THEN 'analyzed'
      WHEN EXISTS (
        SELECT 1 FROM job_failure jf
        INNER JOIN job j ON j.id = jf.job_id
        WHERE jf.item_id = ls.song_id
          AND jf.item_type = 'song'
          AND jf.error_type IN ('validation', 'unsupported', 'auth', 'permanent')
          AND j.account_id = p_account_id
      ) THEN 'failed'
      ELSE 'pending'
    END AS display_state,

    s.id AS song_id,
    s.spotify_id AS song_spotify_id,
    s.name AS song_name,
    s.artists AS song_artists,
    s.artist_ids AS song_artist_ids,
    s.album_name AS song_album_name,
    s.image_url AS song_image_url,
    s.genres AS song_genres,
    a.image_url AS artist_image_url,

    -- Suppress analysis for locked songs
    CASE WHEN ent.is_entitled THEN sa.id ELSE NULL END AS analysis_id,
    CASE WHEN ent.is_entitled THEN sa.analysis ELSE NULL END AS analysis_content,
    CASE WHEN ent.is_entitled THEN sa.model ELSE NULL END AS analysis_model,
    CASE WHEN ent.is_entitled THEN sa.created_at ELSE NULL END AS analysis_created_at,

    saf.tempo AS audio_tempo,
    saf.energy AS audio_energy,
    saf.valence AS audio_valence

  FROM liked_song ls
  JOIN entitled_songs ent ON ent.song_id = ls.song_id
  JOIN song s ON s.id = ls.song_id
  LEFT JOIN artist a ON a.spotify_id = s.artist_ids[1]
  LEFT JOIN song_audio_feature saf ON saf.song_id = s.id
  LEFT JOIN LATERAL (
    SELECT sa2.id, sa2.analysis, sa2.model, sa2.created_at
    FROM song_analysis sa2
    WHERE sa2.song_id = s.id
    ORDER BY sa2.created_at DESC
    LIMIT 1
  ) sa ON true
  LEFT JOIN item_status ist
    ON ist.item_id = ls.song_id
    AND ist.account_id = ls.account_id
    AND ist.item_type = 'song'
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS total_results,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
      )::int AS undecided_count
    FROM match_result mr
    WHERE mr.snapshot_id = v_latest_snapshot_id
      AND mr.song_id = ls.song_id
  ) mr_agg ON true
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    AND (p_cursor IS NULL OR ls.liked_at < p_cursor)
    AND (
      p_filter = 'all'
      OR (p_filter = 'pending' AND ist.id IS NULL AND ent.is_entitled)
      OR (p_filter = 'has_suggestions' AND mr_agg.total_results > 0 AND mr_agg.undecided_count > 0)
      OR (p_filter = 'acted' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
      OR (p_filter = 'no_suggestions' AND ist.id IS NOT NULL AND COALESCE(mr_agg.total_results, 0) = 0)
      OR (p_filter = 'analyzed' AND sa.id IS NOT NULL)
      OR (p_filter = 'matched' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
      OR (p_filter = 'ignored' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
    )
  ORDER BY ls.liked_at DESC
  LIMIT p_limit + 1;
END;
$$;
