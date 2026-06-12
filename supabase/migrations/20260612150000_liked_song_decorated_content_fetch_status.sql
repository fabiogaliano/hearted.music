-- Surface the latest song_lyrics.fetch_status on liked_song_decorated so
-- the UI can distinguish a cleanly-resolved unknown song (fetch settled to
-- not_found, no read, no analysis row) from one that is genuinely still
-- in-flight (no fetch outcome recorded yet).
--
-- A resolved-unknown song sits at display_state = 'pending' forever because
-- display_state only flips to 'analyzed' when a song_analysis row exists.
-- Surfacing content_fetch_status lets the panel predicate short-circuit:
-- content_fetch_status = 'not_found' with no read → "No words yet"
-- rather than "Listening".
--
-- The new column is joined via DISTINCT ON (song_id) ORDER BY updated_at DESC
-- so the latest row per song is returned. NULL when the song has never had a
-- lyrics-fetch attempt recorded.
--
-- display_state is NOT changed: it reflects analysis-row presence, not
-- lyrics-fetch outcome; keeping it stable avoids breaking any consumer that
-- filters on it.
--
-- All three RPC functions that SELECT from liked_song_decorated are also
-- recreated here to expose content_fetch_status in their RETURNS shape.

-- Drop dependent functions first so the view can be dropped and recreated.
-- These functions all SELECT from liked_song_decorated; dropping them before
-- the view avoids the "cannot drop view because other objects depend on it"
-- cascade issue when replacing the view with a different column list.
DROP FUNCTION IF EXISTS public.get_liked_songs_page(uuid, timestamp with time zone, integer, text, text, uuid);
DROP FUNCTION IF EXISTS public.get_liked_song_by_slug(uuid, text);
DROP FUNCTION IF EXISTS public.get_liked_songs_bootstrap_by_slug(uuid, text, integer);
DROP VIEW IF EXISTS public.liked_song_decorated;

-- 2. Recreate the decorated-row view with the new content_fetch_status column.
CREATE VIEW public.liked_song_decorated AS
SELECT
  ls.id,
  ls.account_id,
  ls.liked_at,
  ls.unliked_at,

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
    WHEN tf.has_terminal_failure THEN 'failed'
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
  saf.valence AS audio_valence,

  -- The latest lyrics-fetch outcome for this song; NULL when never attempted.
  -- Drives the "No words yet" vs "Listening" distinction in the panel for songs
  -- whose display_state stays 'pending' but whose fetch has settled (not_found).
  sl_latest.fetch_status AS content_fetch_status,

  -- Internal columns: filtering flags plus the indexed slug/search expressions.
  ent.is_entitled,
  COALESCE(mr_agg.total_results, 0) AS total_results,
  COALESCE(mr_agg.undecided_count, 0) AS undecided_count,
  (ain.id IS NOT NULL) AS has_newness,
  (sa.id IS NOT NULL) AS has_analysis,
  tf.has_terminal_failure,
  public.song_slug(s.artists, s.name) AS slug,
  public.song_artists_joined(s.artists) AS artists_joined

FROM liked_song ls
JOIN song s ON s.id = ls.song_id
CROSS JOIN LATERAL (
  SELECT (
    COALESCE(
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
        WHERE ab.account_id = ls.account_id
      ),
      false
    )
    OR EXISTS (
      SELECT 1 FROM account_song_unlock asu
      WHERE asu.account_id = ls.account_id
        AND asu.song_id = ls.song_id
        AND asu.revoked_at IS NULL
    )
  ) AS is_entitled
) ent
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
CROSS JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1
    FROM job_item_failure jf
    INNER JOIN job j ON j.id = jf.job_id
    WHERE jf.item_type = 'song'
      AND jf.is_terminal = TRUE
      AND j.account_id = ls.account_id
      AND jf.item_id = ls.song_id
  ) AS has_terminal_failure
) tf
LEFT JOIN LATERAL (
  SELECT ms.id
  FROM match_snapshot ms
  WHERE ms.account_id = ls.account_id
  ORDER BY ms.created_at DESC
  LIMIT 1
) latest_snap ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS total_results,
    COUNT(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM match_decision md
        WHERE md.account_id = ls.account_id
          AND md.song_id = mr.song_id
          AND md.playlist_id = mr.playlist_id
      )
    )::int AS undecided_count
  FROM match_result mr
  WHERE mr.snapshot_id = latest_snap.id
    AND mr.song_id = ls.song_id
) mr_agg ON true
LEFT JOIN LATERAL (
  SELECT sl.fetch_status
  FROM song_lyrics sl
  WHERE sl.song_id = s.id
  ORDER BY sl.updated_at DESC
  LIMIT 1
) sl_latest ON true;

REVOKE ALL ON public.liked_song_decorated FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.liked_song_decorated TO service_role;

-- 3. Rewrite get_liked_songs_page to expose content_fetch_status.
-- Same 6-arg signature; output shape gains one column.
CREATE OR REPLACE FUNCTION public.get_liked_songs_page(p_account_id uuid, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_filter text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_cursor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, liked_at timestamp with time zone, matching_status text, display_state text, song_id uuid, song_spotify_id text, song_name text, song_artists text[], song_artist_ids text[], song_album_name text, song_image_url text, song_genres text[], artist_image_url text, analysis_id uuid, analysis_content jsonb, analysis_model text, analysis_created_at timestamp with time zone, audio_tempo real, audio_energy real, audio_valence real, content_fetch_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_search TEXT;
  v_search_pattern TEXT;
BEGIN
  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_search_pattern := CASE
    WHEN v_search IS NULL THEN NULL
    ELSE '%' || v_search || '%'
  END;

  RETURN QUERY
  SELECT
    d.id, d.liked_at, d.matching_status, d.display_state, d.song_id,
    d.song_spotify_id, d.song_name, d.song_artists, d.song_artist_ids,
    d.song_album_name, d.song_image_url, d.song_genres, d.artist_image_url,
    d.analysis_id, d.analysis_content, d.analysis_model, d.analysis_created_at,
    d.audio_tempo, d.audio_energy, d.audio_valence, d.content_fetch_status
  FROM liked_song_decorated d
  WHERE d.account_id = p_account_id
    AND d.unliked_at IS NULL
    AND (
      p_cursor IS NULL
      OR d.liked_at < p_cursor
      OR (d.liked_at = p_cursor AND d.id < p_cursor_id)
    )
    AND (
      v_search_pattern IS NULL
      OR d.song_name ILIKE v_search_pattern
      OR d.artists_joined ILIKE v_search_pattern
    )
    AND (
      p_filter = 'all'
      OR (
        p_filter = 'pending'
        AND NOT d.has_newness
        AND d.is_entitled
        AND NOT d.has_terminal_failure
      )
      OR (p_filter = 'has_suggestions' AND d.total_results > 0 AND d.undecided_count > 0)
      OR (p_filter = 'acted' AND d.total_results > 0 AND d.undecided_count = 0)
      OR (p_filter = 'no_suggestions' AND d.has_newness AND d.total_results = 0)
      OR (p_filter = 'analyzed' AND d.has_analysis)
      OR (p_filter = 'matched' AND d.total_results > 0 AND d.undecided_count = 0)
      OR (p_filter = 'ignored' AND d.total_results > 0 AND d.undecided_count = 0)
    )
  ORDER BY d.liked_at DESC, d.id DESC
  LIMIT p_limit + 1;
END;
$function$;

-- 4. Rewrite get_liked_song_by_slug to expose content_fetch_status.
CREATE OR REPLACE FUNCTION public.get_liked_song_by_slug(p_account_id uuid, p_slug text)
 RETURNS TABLE(id uuid, liked_at timestamp with time zone, matching_status text, display_state text, song_id uuid, song_spotify_id text, song_name text, song_artists text[], song_artist_ids text[], song_album_name text, song_image_url text, song_genres text[], artist_image_url text, analysis_id uuid, analysis_content jsonb, analysis_model text, analysis_created_at timestamp with time zone, audio_tempo real, audio_energy real, audio_valence real, content_fetch_status text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    d.id, d.liked_at, d.matching_status, d.display_state, d.song_id,
    d.song_spotify_id, d.song_name, d.song_artists, d.song_artist_ids,
    d.song_album_name, d.song_image_url, d.song_genres, d.artist_image_url,
    d.analysis_id, d.analysis_content, d.analysis_model, d.analysis_created_at,
    d.audio_tempo, d.audio_energy, d.audio_valence, d.content_fetch_status
  FROM liked_song_decorated d
  WHERE d.account_id = p_account_id
    AND d.unliked_at IS NULL
    AND d.slug = p_slug
  ORDER BY d.liked_at DESC, d.id DESC
  LIMIT 1;
END;
$function$;

-- 5. Rewrite get_liked_songs_bootstrap_by_slug to expose content_fetch_status.
CREATE OR REPLACE FUNCTION public.get_liked_songs_bootstrap_by_slug(p_account_id uuid, p_slug text, p_trailing_limit integer DEFAULT 30)
 RETURNS TABLE(id uuid, liked_at timestamp with time zone, matching_status text, display_state text, song_id uuid, song_spotify_id text, song_name text, song_artists text[], song_artist_ids text[], song_album_name text, song_image_url text, song_genres text[], artist_image_url text, analysis_id uuid, analysis_content jsonb, analysis_model text, analysis_created_at timestamp with time zone, audio_tempo real, audio_energy real, audio_valence real, content_fetch_status text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anchor_liked_at timestamptz;
  v_anchor_id uuid;
BEGIN
  SELECT ls.liked_at, ls.id
  INTO v_anchor_liked_at, v_anchor_id
  FROM liked_song ls
  JOIN song s ON s.id = ls.song_id
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    AND public.song_slug(s.artists, s.name) = p_slug
  ORDER BY ls.liked_at DESC, ls.id DESC
  LIMIT 1;

  IF v_anchor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    combined.id, combined.liked_at, combined.matching_status,
    combined.display_state, combined.song_id, combined.song_spotify_id,
    combined.song_name, combined.song_artists, combined.song_artist_ids,
    combined.song_album_name, combined.song_image_url, combined.song_genres,
    combined.artist_image_url, combined.analysis_id, combined.analysis_content,
    combined.analysis_model, combined.analysis_created_at, combined.audio_tempo,
    combined.audio_energy, combined.audio_valence, combined.content_fetch_status
  FROM (
    -- Prefix: newest liked song through the anchor (inclusive).
    SELECT
      d.id, d.liked_at, d.matching_status, d.display_state, d.song_id,
      d.song_spotify_id, d.song_name, d.song_artists, d.song_artist_ids,
      d.song_album_name, d.song_image_url, d.song_genres, d.artist_image_url,
      d.analysis_id, d.analysis_content, d.analysis_model, d.analysis_created_at,
      d.audio_tempo, d.audio_energy, d.audio_valence, d.content_fetch_status
    FROM liked_song_decorated d
    WHERE d.account_id = p_account_id
      AND d.unliked_at IS NULL
      AND (d.liked_at, d.id) >= (v_anchor_liked_at, v_anchor_id)

    UNION ALL

    -- Trailing: the next p_trailing_limit + 1 older rows after the anchor.
    SELECT
      t.id, t.liked_at, t.matching_status, t.display_state, t.song_id,
      t.song_spotify_id, t.song_name, t.song_artists, t.song_artist_ids,
      t.song_album_name, t.song_image_url, t.song_genres, t.artist_image_url,
      t.analysis_id, t.analysis_content, t.analysis_model, t.analysis_created_at,
      t.audio_tempo, t.audio_energy, t.audio_valence, t.content_fetch_status
    FROM (
      SELECT d.*
      FROM liked_song_decorated d
      WHERE d.account_id = p_account_id
        AND d.unliked_at IS NULL
        AND (d.liked_at, d.id) < (v_anchor_liked_at, v_anchor_id)
      ORDER BY d.liked_at DESC, d.id DESC
      LIMIT p_trailing_limit + 1
    ) t
  ) combined
  ORDER BY combined.liked_at DESC, combined.id DESC;
END;
$function$;
