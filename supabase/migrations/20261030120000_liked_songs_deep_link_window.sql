-- Windowed liked-songs deep link (expand only).
--
-- get_liked_songs_bootstrap_by_slug returns every liked song from the newest
-- through the deep-linked one, so a link to an old song server-renders the
-- whole prefix (hundreds of rows, ~3 MB of HTML). These two functions replace it
-- with a window around the song plus a newer-direction page read, so the list
-- can start mid-library and load upwards as well as downwards.
--
-- The old function stays until the deployed app no longer calls it; dropping it
-- is a later, manual contract step.
--
-- Both return only the columns the list rows render: the analysis blob is read
-- per song by the detail panel.

-- Rows around the newest active like matching p_slug, newest first:
--   up to p_rows_before + 1 newer rows (the extra one only tells the caller that
--   more newer rows exist), the anchor, and up to p_rows_after + 1 older rows
--   (likewise). No rows when the slug matches nothing.
CREATE FUNCTION public.get_liked_songs_window_by_slug(
  p_account_id uuid,
  p_slug text,
  p_rows_before integer,
  p_rows_after integer,
  p_min_score double precision DEFAULT 0
)
 RETURNS TABLE(id uuid, liked_at timestamp with time zone, matching_status text, display_state text, song_id uuid, song_spotify_id text, song_name text, song_artists text[], song_artist_ids text[], song_album_name text, song_image_url text, song_genres text[], artist_image_url text, audio_tempo real, audio_energy real, audio_valence real, content_fetch_status text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anchor_liked_at timestamptz;
  v_anchor_id uuid;
  v_latest_snapshot_id uuid;
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

  SELECT ms.id INTO v_latest_snapshot_id
  FROM match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    w.id, w.liked_at,
    CASE
      WHEN NOT w.is_entitled THEN NULL
      WHEN vis.total_results > 0 AND vis.undecided_count > 0 THEN 'has_suggestions'
      WHEN vis.total_results > 0 AND vis.undecided_count = 0 THEN 'acted'
      WHEN w.has_newness THEN 'no_suggestions'
      ELSE 'pending'
    END AS matching_status,
    w.display_state, w.song_id, w.song_spotify_id, w.song_name, w.song_artists,
    w.song_artist_ids, w.song_album_name, w.song_image_url, w.song_genres,
    w.artist_image_url, w.audio_tempo, w.audio_energy, w.audio_valence,
    w.content_fetch_status
  FROM (
    -- Each half is its own keyset scan off the anchor, so the window costs the
    -- same for the newest song as for the oldest.
    (
      SELECT
        d.id, d.liked_at, d.is_entitled, d.has_newness, d.display_state,
        d.song_id, d.song_spotify_id, d.song_name, d.song_artists,
        d.song_artist_ids, d.song_album_name, d.song_image_url, d.song_genres,
        d.artist_image_url, d.audio_tempo, d.audio_energy, d.audio_valence,
        d.content_fetch_status
      FROM liked_song_decorated d
      WHERE d.account_id = p_account_id
        AND d.unliked_at IS NULL
        AND (d.liked_at, d.id) > (v_anchor_liked_at, v_anchor_id)
      ORDER BY d.liked_at ASC, d.id ASC
      LIMIT p_rows_before + 1
    )
    UNION ALL
    (
      SELECT
        d.id, d.liked_at, d.is_entitled, d.has_newness, d.display_state,
        d.song_id, d.song_spotify_id, d.song_name, d.song_artists,
        d.song_artist_ids, d.song_album_name, d.song_image_url, d.song_genres,
        d.artist_image_url, d.audio_tempo, d.audio_energy, d.audio_valence,
        d.content_fetch_status
      FROM liked_song_decorated d
      WHERE d.account_id = p_account_id
        AND d.unliked_at IS NULL
        AND (d.liked_at, d.id) <= (v_anchor_liked_at, v_anchor_id)
      ORDER BY d.liked_at DESC, d.id DESC
      LIMIT p_rows_after + 2
    )
  ) w
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
      AND mr.song_id = w.song_id
      AND mr.score >= p_min_score
  ) vis ON true
  ORDER BY w.liked_at DESC, w.id DESC;
END;
$function$;

-- The p_limit active likes just newer than the (p_cursor, p_cursor_id) keyset
-- position, newest first, plus one more when even newer likes exist. The
-- unfiltered list only: a deep link seeds nothing else. A new name rather than
-- a get_liked_songs_page overload, which PostgREST can't resolve reliably.
CREATE FUNCTION public.get_liked_songs_page_newer(
  p_account_id uuid,
  p_cursor timestamp with time zone,
  p_cursor_id uuid,
  p_limit integer,
  p_min_score double precision DEFAULT 0
)
 RETURNS TABLE(id uuid, liked_at timestamp with time zone, matching_status text, display_state text, song_id uuid, song_spotify_id text, song_name text, song_artists text[], song_artist_ids text[], song_album_name text, song_image_url text, song_genres text[], artist_image_url text, audio_tempo real, audio_energy real, audio_valence real, content_fetch_status text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_latest_snapshot_id uuid;
BEGIN
  SELECT ms.id INTO v_latest_snapshot_id
  FROM match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    w.id, w.liked_at,
    CASE
      WHEN NOT w.is_entitled THEN NULL
      WHEN vis.total_results > 0 AND vis.undecided_count > 0 THEN 'has_suggestions'
      WHEN vis.total_results > 0 AND vis.undecided_count = 0 THEN 'acted'
      WHEN w.has_newness THEN 'no_suggestions'
      ELSE 'pending'
    END AS matching_status,
    w.display_state, w.song_id, w.song_spotify_id, w.song_name, w.song_artists,
    w.song_artist_ids, w.song_album_name, w.song_image_url, w.song_genres,
    w.artist_image_url, w.audio_tempo, w.audio_energy, w.audio_valence,
    w.content_fetch_status
  FROM (
    SELECT
      d.id, d.liked_at, d.is_entitled, d.has_newness, d.display_state,
      d.song_id, d.song_spotify_id, d.song_name, d.song_artists,
      d.song_artist_ids, d.song_album_name, d.song_image_url, d.song_genres,
      d.artist_image_url, d.audio_tempo, d.audio_energy, d.audio_valence,
      d.content_fetch_status
    FROM liked_song_decorated d
    WHERE d.account_id = p_account_id
      AND d.unliked_at IS NULL
      AND (d.liked_at, d.id) > (p_cursor, p_cursor_id)
    ORDER BY d.liked_at ASC, d.id ASC
    LIMIT p_limit + 1
  ) w
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
      AND mr.song_id = w.song_id
      AND mr.score >= p_min_score
  ) vis ON true
  ORDER BY w.liked_at DESC, w.id DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_liked_songs_window_by_slug(uuid, text, integer, integer, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liked_songs_window_by_slug(uuid, text, integer, integer, double precision) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_liked_songs_page_newer(uuid, timestamp with time zone, uuid, integer, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liked_songs_page_newer(uuid, timestamp with time zone, uuid, integer, double precision) TO service_role;
