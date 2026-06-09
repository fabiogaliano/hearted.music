-- Stable keyset pagination for get_liked_songs_page.
--
-- The cursor was `liked_at` alone, compared with a strict `<`. When many rows
-- share a liked_at (a bulk Spotify import stamped 76 songs with one timestamp),
-- a page boundary landing inside that block skipped every remaining tied row.
-- Deep songs then vanished from pagination — the deep-link bootstrap, the
-- by-slug resolver, and normal infinite scroll all lost them (e.g. a 288-song
-- library walked only 227 rows). Fix: a unique tiebreak on ls.id — order by
-- (liked_at DESC, id DESC) and compare the cursor as a tuple. Adds p_cursor_id;
-- callers pass the last row's id alongside its liked_at.

DROP FUNCTION IF EXISTS public.get_liked_songs_page(UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_liked_songs_page(p_account_id uuid, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_filter text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_cursor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, liked_at timestamp with time zone, matching_status text, display_state text, song_id uuid, song_spotify_id text, song_name text, song_artists text[], song_artist_ids text[], song_album_name text, song_image_url text, song_genres text[], artist_image_url text, analysis_id uuid, analysis_content jsonb, analysis_model text, analysis_created_at timestamp with time zone, audio_tempo real, audio_energy real, audio_valence real)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_latest_snapshot_id UUID;
  v_search TEXT;
  v_search_pattern TEXT;
BEGIN
  SELECT ms.id INTO v_latest_snapshot_id
  FROM match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
  LIMIT 1;

  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_search_pattern := CASE
    WHEN v_search IS NULL THEN NULL
    ELSE '%' || v_search || '%'
  END;

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
  ),
  terminal_failures AS (
    SELECT DISTINCT jf.item_id AS song_id
    FROM job_item_failure jf
    INNER JOIN job j ON j.id = jf.job_id
    WHERE jf.item_type = 'song'
      AND jf.is_terminal = TRUE
      AND j.account_id = p_account_id
  )
  SELECT
    ls.id,
    ls.liked_at,

    CASE
      WHEN NOT ent.is_entitled THEN NULL
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count > 0 THEN 'has_suggestions'
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count = 0 THEN 'acted'
      WHEN ain.id IS NOT NULL THEN 'no_suggestions'
      ELSE 'pending'
    END AS matching_status,

    CASE
      WHEN NOT ent.is_entitled THEN 'locked'
      WHEN sa.id IS NOT NULL THEN 'analyzed'
      WHEN tf.song_id IS NOT NULL THEN 'failed'
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
  LEFT JOIN account_item_newness ain
    ON ain.item_id = ls.song_id
    AND ain.account_id = ls.account_id
    AND ain.item_type = 'song'
  LEFT JOIN terminal_failures tf
    ON tf.song_id = ls.song_id
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
    AND (
      p_cursor IS NULL
      OR ls.liked_at < p_cursor
      OR (ls.liked_at = p_cursor AND ls.id < p_cursor_id)
    )
    AND (
      v_search_pattern IS NULL
      OR s.name ILIKE v_search_pattern
      OR public.song_artists_joined(s.artists) ILIKE v_search_pattern
    )
    AND (
      p_filter = 'all'
      OR (
        p_filter = 'pending'
        AND ain.id IS NULL
        AND ent.is_entitled
        AND tf.song_id IS NULL
      )
      OR (p_filter = 'has_suggestions' AND mr_agg.total_results > 0 AND mr_agg.undecided_count > 0)
      OR (p_filter = 'acted' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
      OR (p_filter = 'no_suggestions' AND ain.id IS NOT NULL AND COALESCE(mr_agg.total_results, 0) = 0)
      OR (p_filter = 'analyzed' AND sa.id IS NOT NULL)
      OR (p_filter = 'matched' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
      OR (p_filter = 'ignored' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
    )
  ORDER BY ls.liked_at DESC, ls.id DESC
  LIMIT p_limit + 1;
END;
$function$

;

-- Re-apply hardening for the new 6-arg signature; the 5-arg variant was dropped
-- above, so the REVOKE/GRANT in earlier migrations no longer targets it.
REVOKE EXECUTE ON FUNCTION
  public.get_liked_songs_page(UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.get_liked_songs_page(UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, UUID)
TO service_role;
