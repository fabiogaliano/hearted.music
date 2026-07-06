-- Single-RPC fast path for presenting a captured playlist-orientation card.
--
-- Collapses the 3-round-trip fast path (fetchOwnedQueueItem + getPlaylistById +
-- read_match_review_item_song_suggestions) into one call. Only valid for
-- playlist-orientation items that already have visible_pairs_captured_at set.
--
-- Returns JSONB with:
--   status = 'ready'          — payload includes playlist + suggestions
--   status = 'not_captured'   — item exists but has no captured pairs yet
--   status = 'not_found'      — item doesn't exist or isn't owned
--   status = 'not_playlist'   — item is song-orientation (wrong path)
--   status = 'playlist_gone'  — playlist no longer owned by account
--   status = 'no_visible_suggestions' — capture ran but stored zero pairs
--                (an all-dismissed capture instead returns 'ready' with an
--                empty list, matching the legacy disambiguation)
--
-- Resolved state is deliberately NOT special-cased: legacy presentMatchReviewItem
-- served a captured playlist card as 'ready' regardless of state, and this RPC
-- must keep that identical semantics (a resolved-but-captured card still renders).

CREATE OR REPLACE FUNCTION public.present_match_review_item_fast(
  p_item_id      UUID,
  p_account_id   UUID,
  p_limit        INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item         RECORD;
  v_playlist     RECORD;
  v_suggestions  JSONB;
  v_total_active BIGINT;
  v_captured_ct  BIGINT;
BEGIN
  -- 1. Ownership check + load queue item
  SELECT qi.id, qi.session_id, qi.account_id, qi.orientation,
         qi.song_id, qi.playlist_id, qi.source_snapshot_id,
         qi.position, qi.state, qi.resolution, qi.source_fit_score,
         qi.was_new_at_enqueue, qi.presented_at, qi.resolved_at,
         qi.visible_pairs_captured_at, qi.created_at, qi.updated_at
  INTO v_item
  FROM public.match_review_queue_item qi
  WHERE qi.id = p_item_id
    AND qi.account_id = p_account_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_item.orientation <> 'playlist' THEN
    RETURN jsonb_build_object('status', 'not_playlist');
  END IF;

  IF v_item.visible_pairs_captured_at IS NULL THEN
    RETURN jsonb_build_object('status', 'not_captured');
  END IF;

  -- 2. Playlist lookup (account-scoped = ownership check)
  SELECT p.id, p.spotify_id, p.name, p.match_intent,
         p.image_url, p.song_count
  INTO v_playlist
  FROM public.playlist p
  WHERE p.id = v_item.playlist_id
    AND p.account_id = p_account_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'playlist_gone');
  END IF;

  -- 3. Suggestion rows — same logic as read_match_review_item_song_suggestions
  --    but inlined to avoid an extra function-call round trip.
  SELECT COALESCE(jsonb_agg(row_data ORDER BY rn), '[]'::JSONB),
         COALESCE(MAX(total_ct), 0)
  INTO v_suggestions, v_total_active
  FROM (
    SELECT
      jsonb_build_object(
        'song_id',      s.id,
        'name',         s.name,
        'artists',      to_jsonb(s.artists),
        'album_name',   s.album_name,
        'image_url',    s.image_url,
        'spotify_id',   s.spotify_id,
        'genres',       to_jsonb(s.genres),
        'fit_score',    vp.fit_score,
        'visible_rank', vp.visible_rank,
        'model_rank',   vp.model_rank
      ) AS row_data,
      count(*) OVER () AS total_ct,
      row_number() OVER (
        ORDER BY vp.fit_score DESC, vp.model_rank ASC, vp.song_id ASC
      ) AS rn
    FROM public.match_review_item_visible_pair vp
    JOIN public.song s ON s.id = vp.song_id
    WHERE vp.queue_item_id = p_item_id
      AND vp.account_id = p_account_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.match_decision d
        WHERE d.account_id  = p_account_id
          AND d.song_id     = vp.song_id
          AND d.playlist_id = vp.playlist_id
          AND d.decision    = 'dismissed'
      )
  ) sub
  WHERE rn <= COALESCE(p_limit, 2147483647);

  -- Zero active rows: disambiguate empty capture vs all-dismissed
  IF v_total_active = 0 THEN
    SELECT count(*)
    INTO v_captured_ct
    FROM public.match_review_item_visible_pair
    WHERE queue_item_id = p_item_id
      AND account_id = p_account_id;

    IF v_captured_ct = 0 THEN
      RETURN jsonb_build_object(
        'status', 'no_visible_suggestions',
        'item', jsonb_build_object('id', v_item.id, 'state', v_item.state)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ready',
    'item', jsonb_build_object(
      'id', v_item.id,
      'session_id', v_item.session_id,
      'orientation', v_item.orientation,
      'playlist_id', v_item.playlist_id,
      'state', v_item.state,
      'visible_pairs_captured_at', v_item.visible_pairs_captured_at
    ),
    'playlist', jsonb_build_object(
      'id', v_playlist.id,
      'spotify_id', v_playlist.spotify_id,
      'name', v_playlist.name,
      'match_intent', v_playlist.match_intent,
      'image_url', v_playlist.image_url,
      'song_count', v_playlist.song_count
    ),
    'suggestions', v_suggestions,
    'total_active_count', v_total_active
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.present_match_review_item_fast(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.present_match_review_item_fast(UUID, UUID, INTEGER)
  TO service_role;
