-- Match strictness — a per-user read-time quality bar.
--
-- Stores the preset *name* (not a number) on user_preferences; the preset→score
-- mapping lives in app code (strictness.ts) so thresholds can be retuned without
-- a data migration. The scoring pipeline and match_result writes are untouched —
-- this is purely a read-time filter, applied by passing p_min_score into the
-- read RPCs below. Default 'balanced' for everyone, existing users included.
--
-- The liked_song_decorated VIEW is intentionally left in place: a view cannot
-- take a parameter, so the per-user threshold is applied inside each function via
-- a LATERAL that recomputes the visible match counts. The view's own
-- (unfiltered) total_results / undecided_count columns are simply not read by
-- these functions anymore — they recompute against `vis` so that total_results
-- and undecided_count both mean *visible* matches. A song whose only matches sit
-- below the bar therefore reads as no_suggestions, not has_suggestions.

-- 1. Column ------------------------------------------------------------------
-- TEXT + CHECK (the consent_status precedent), not a Postgres enum, so the set
-- of presets can grow with a one-line CHECK change rather than an ALTER TYPE.
ALTER TABLE user_preferences
  ADD COLUMN match_strictness TEXT NOT NULL DEFAULT 'balanced'
  CHECK (match_strictness IN ('open', 'balanced', 'strict'));


-- 2. get_liked_songs_stats: add p_min_score; gate the has_suggestions count ---
-- New signature (UUID, DOUBLE PRECISION); drop the old single-arg version first
-- so the defaulted overload can never be ambiguous.
DROP FUNCTION IF EXISTS get_liked_songs_stats(UUID);

CREATE FUNCTION get_liked_songs_stats(
  p_account_id UUID,
  p_min_score DOUBLE PRECISION DEFAULT 0
)
RETURNS TABLE (
  total           BIGINT,
  analyzed        BIGINT,
  matched         BIGINT,
  has_suggestions BIGINT,
  new_suggestions BIGINT,
  pending         BIGINT,
  locked          BIGINT
) AS $$
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
    COUNT(*)::BIGINT,

    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id
    ))::BIGINT,

    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
    ) AND NOT EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    ))::BIGINT,

    -- has_suggestions: at least one *visible* (>= threshold) undecided match.
    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND mr.score >= p_min_score
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    ))::BIGINT,

    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND mr.score >= p_min_score
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    ) AND EXISTS (
      SELECT 1 FROM account_item_newness ain
      WHERE ain.item_id = ls.song_id
        AND ain.account_id = ls.account_id
        AND ain.item_type = 'song'
        AND ain.is_new = true
    ))::BIGINT,

    COUNT(*) FILTER (
      WHERE ent.is_entitled
      AND NOT EXISTS (
        SELECT 1 FROM account_item_newness ain
        WHERE ain.item_id = ls.song_id
          AND ain.account_id = ls.account_id
          AND ain.item_type = 'song'
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_item_failure jf
        INNER JOIN job j ON j.id = jf.job_id
        WHERE jf.item_id = ls.song_id
          AND jf.item_type = 'song'
          AND jf.is_terminal = TRUE
          AND j.account_id = p_account_id
      )
    )::BIGINT,

    COUNT(*) FILTER (WHERE NOT ent.is_entitled)::BIGINT

  FROM liked_song ls
  JOIN entitled_songs ent ON ent.song_id = ls.song_id
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;


-- 3. Liked-songs page RPCs: add p_min_score, recompute visible counts ---------
-- New 7th / 3rd / 4th argument; drop the old signatures first so the defaulted
-- overload is unambiguous. The view stays as-is; each function joins a LATERAL
-- (`vis`) that aggregates match_result for the song under the latest snapshot
-- with `score >= p_min_score`, and derives matching_status + filter predicates
-- from those visible counts instead of the view's unfiltered columns.
DROP FUNCTION IF EXISTS public.get_liked_songs_page(uuid, timestamp with time zone, integer, text, text, uuid);
DROP FUNCTION IF EXISTS public.get_liked_song_by_slug(uuid, text);
DROP FUNCTION IF EXISTS public.get_liked_songs_bootstrap_by_slug(uuid, text, integer);

CREATE FUNCTION public.get_liked_songs_page(p_account_id uuid, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_filter text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_cursor_id uuid DEFAULT NULL::uuid, p_min_score double precision DEFAULT 0)
 RETURNS TABLE(id uuid, liked_at timestamp with time zone, matching_status text, display_state text, song_id uuid, song_spotify_id text, song_name text, song_artists text[], song_artist_ids text[], song_album_name text, song_image_url text, song_genres text[], artist_image_url text, analysis_id uuid, analysis_content jsonb, analysis_model text, analysis_created_at timestamp with time zone, audio_tempo real, audio_energy real, audio_valence real, content_fetch_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_search TEXT;
  v_search_pattern TEXT;
  v_latest_snapshot_id UUID;
BEGIN
  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_search_pattern := CASE
    WHEN v_search IS NULL THEN NULL
    ELSE '%' || v_search || '%'
  END;

  SELECT ms.id INTO v_latest_snapshot_id
  FROM match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    d.id, d.liked_at,
    CASE
      WHEN NOT d.is_entitled THEN NULL
      WHEN vis.total_results > 0 AND vis.undecided_count > 0 THEN 'has_suggestions'
      WHEN vis.total_results > 0 AND vis.undecided_count = 0 THEN 'acted'
      WHEN d.has_newness THEN 'no_suggestions'
      ELSE 'pending'
    END AS matching_status,
    d.display_state, d.song_id,
    d.song_spotify_id, d.song_name, d.song_artists, d.song_artist_ids,
    d.song_album_name, d.song_image_url, d.song_genres, d.artist_image_url,
    d.analysis_id, d.analysis_content, d.analysis_model, d.analysis_created_at,
    d.audio_tempo, d.audio_energy, d.audio_valence, d.content_fetch_status
  FROM liked_song_decorated d
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
      AND mr.song_id = d.song_id
      AND mr.score >= p_min_score
  ) vis ON true
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
      OR (p_filter = 'has_suggestions' AND vis.total_results > 0 AND vis.undecided_count > 0)
      OR (p_filter = 'acted' AND vis.total_results > 0 AND vis.undecided_count = 0)
      OR (p_filter = 'no_suggestions' AND d.has_newness AND vis.total_results = 0)
      OR (p_filter = 'analyzed' AND d.has_analysis)
      OR (p_filter = 'matched' AND vis.total_results > 0 AND vis.undecided_count = 0)
      OR (p_filter = 'ignored' AND vis.total_results > 0 AND vis.undecided_count = 0)
    )
  ORDER BY d.liked_at DESC, d.id DESC
  LIMIT p_limit + 1;
END;
$function$;

CREATE FUNCTION public.get_liked_song_by_slug(p_account_id uuid, p_slug text, p_min_score double precision DEFAULT 0)
 RETURNS TABLE(id uuid, liked_at timestamp with time zone, matching_status text, display_state text, song_id uuid, song_spotify_id text, song_name text, song_artists text[], song_artist_ids text[], song_album_name text, song_image_url text, song_genres text[], artist_image_url text, analysis_id uuid, analysis_content jsonb, analysis_model text, analysis_created_at timestamp with time zone, audio_tempo real, audio_energy real, audio_valence real, content_fetch_status text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_latest_snapshot_id UUID;
BEGIN
  SELECT ms.id INTO v_latest_snapshot_id
  FROM match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    d.id, d.liked_at,
    CASE
      WHEN NOT d.is_entitled THEN NULL
      WHEN vis.total_results > 0 AND vis.undecided_count > 0 THEN 'has_suggestions'
      WHEN vis.total_results > 0 AND vis.undecided_count = 0 THEN 'acted'
      WHEN d.has_newness THEN 'no_suggestions'
      ELSE 'pending'
    END AS matching_status,
    d.display_state, d.song_id,
    d.song_spotify_id, d.song_name, d.song_artists, d.song_artist_ids,
    d.song_album_name, d.song_image_url, d.song_genres, d.artist_image_url,
    d.analysis_id, d.analysis_content, d.analysis_model, d.analysis_created_at,
    d.audio_tempo, d.audio_energy, d.audio_valence, d.content_fetch_status
  FROM liked_song_decorated d
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
      AND mr.song_id = d.song_id
      AND mr.score >= p_min_score
  ) vis ON true
  WHERE d.account_id = p_account_id
    AND d.unliked_at IS NULL
    AND d.slug = p_slug
  ORDER BY d.liked_at DESC, d.id DESC
  LIMIT 1;
END;
$function$;

CREATE FUNCTION public.get_liked_songs_bootstrap_by_slug(p_account_id uuid, p_slug text, p_trailing_limit integer DEFAULT 30, p_min_score double precision DEFAULT 0)
 RETURNS TABLE(id uuid, liked_at timestamp with time zone, matching_status text, display_state text, song_id uuid, song_spotify_id text, song_name text, song_artists text[], song_artist_ids text[], song_album_name text, song_image_url text, song_genres text[], artist_image_url text, analysis_id uuid, analysis_content jsonb, analysis_model text, analysis_created_at timestamp with time zone, audio_tempo real, audio_energy real, audio_valence real, content_fetch_status text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anchor_liked_at timestamptz;
  v_anchor_id uuid;
  v_latest_snapshot_id UUID;
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
      d.id, d.liked_at,
      CASE
        WHEN NOT d.is_entitled THEN NULL
        WHEN vis.total_results > 0 AND vis.undecided_count > 0 THEN 'has_suggestions'
        WHEN vis.total_results > 0 AND vis.undecided_count = 0 THEN 'acted'
        WHEN d.has_newness THEN 'no_suggestions'
        ELSE 'pending'
      END AS matching_status,
      d.display_state, d.song_id,
      d.song_spotify_id, d.song_name, d.song_artists, d.song_artist_ids,
      d.song_album_name, d.song_image_url, d.song_genres, d.artist_image_url,
      d.analysis_id, d.analysis_content, d.analysis_model, d.analysis_created_at,
      d.audio_tempo, d.audio_energy, d.audio_valence, d.content_fetch_status
    FROM liked_song_decorated d
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
        AND mr.song_id = d.song_id
        AND mr.score >= p_min_score
    ) vis ON true
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
      SELECT
        d.id, d.liked_at,
        CASE
          WHEN NOT d.is_entitled THEN NULL
          WHEN vis.total_results > 0 AND vis.undecided_count > 0 THEN 'has_suggestions'
          WHEN vis.total_results > 0 AND vis.undecided_count = 0 THEN 'acted'
          WHEN d.has_newness THEN 'no_suggestions'
          ELSE 'pending'
        END AS matching_status,
        d.display_state, d.song_id,
        d.song_spotify_id, d.song_name, d.song_artists, d.song_artist_ids,
        d.song_album_name, d.song_image_url, d.song_genres, d.artist_image_url,
        d.analysis_id, d.analysis_content, d.analysis_model, d.analysis_created_at,
        d.audio_tempo, d.audio_energy, d.audio_valence, d.content_fetch_status
      FROM liked_song_decorated d
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
          AND mr.song_id = d.song_id
          AND mr.score >= p_min_score
      ) vis ON true
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


-- 4. Re-apply the service-role-only hardening for the new signatures ----------
REVOKE EXECUTE ON FUNCTION public.get_liked_songs_stats(uuid, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liked_songs_stats(uuid, double precision) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_liked_songs_page(uuid, timestamp with time zone, integer, text, text, uuid, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liked_songs_page(uuid, timestamp with time zone, integer, text, text, uuid, double precision) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_liked_song_by_slug(uuid, text, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liked_song_by_slug(uuid, text, double precision) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_liked_songs_bootstrap_by_slug(uuid, text, integer, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liked_songs_bootstrap_by_slug(uuid, text, integer, double precision) TO service_role;
