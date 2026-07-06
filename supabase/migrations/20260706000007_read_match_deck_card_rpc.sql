-- Match deck read model, Phase 1b (plan §7): read_match_deck_card.
--
-- Generalizes present_match_review_item_fast (20260706000002, playlist-only) to
-- BOTH orientations and folds in the presented_at newness marking that the
-- separate markMatchReviewItemPresented endpoint did (that endpoint is deleted
-- in a later phase). It is a pure join over captured pairs + subject metadata,
-- with dismissed pairs excluded in SQL (the NOT EXISTS match_decision predicate
-- already used by the fast path and read_match_review_item_song_suggestions).
--
-- Because it writes presented_at it is VOLATILE (present_match_review_item_fast
-- is STABLE). The write is idempotent — UPDATE … WHERE presented_at IS NULL —
-- and is gated by p_mark_presented so callers can read a NEXT card without
-- marking it presented (only the CURRENT card is marked).
--
-- JSONB status union (parallel across orientations):
--   ready                  — payload includes subject + suggestions + total.
--   not_captured           — item exists but visible_pairs_captured_at IS NULL.
--   not_found              — item doesn't exist or isn't owned by the account.
--   playlist_gone          — (playlist arm) subject playlist no longer owned.
--   song_gone              — (song arm) subject song row no longer exists.
--   no_visible_suggestions — capture ran but stored zero pairs (empty capture);
--                            an all-dismissed capture instead returns 'ready'
--                            with an empty suggestions list (matches the legacy
--                            disambiguation in present_match_review_item_fast).
--
-- The playlist arm returns the EXACT JSONB shape present_match_review_item_fast
-- returns (item + playlist + suggestions[song rows] + total_active_count) so the
-- Phase 3 TS parser can reuse PresentMatchReviewItemFastRpcResult unchanged.
-- The song arm mirrors it: item + song (subject) + suggestions[playlist rows] +
-- total_active_count, keeping the top-level keys `suggestions`/`total_active_count`
-- parallel to the playlist arm. The song subject folds in the decorative audio
-- feature + latest analysis reads (the same reads fetchSongOrientationData does)
-- so a song card renders from one round trip; both are nullable.
--
-- nextCursor is NOT computed here — the RPC returns the first page (capped by
-- p_limit) + the post-dismissal total; the cursor is derived by the Phase 3 TS
-- wrapper from the shared helper.

CREATE OR REPLACE FUNCTION public.read_match_deck_card(
  p_item_id        UUID,
  p_account_id     UUID,
  p_limit          INTEGER DEFAULT NULL,
  p_mark_presented BOOLEAN DEFAULT true
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item         RECORD;
  v_playlist     RECORD;
  v_song         RECORD;
  v_audio        RECORD;
  v_analysis     JSONB;
  v_suggestions  JSONB;
  v_total_active BIGINT;
  v_captured_ct  BIGINT;
BEGIN
  -- 1. Ownership check + load queue item (same column set as the fast path).
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

  -- Idempotent newness write, folded in from markMatchReviewItemPresented.
  -- First-write-wins: only stamps presented_at on the first read of the card.
  -- Placed before the status branches so the item is marked surfaced regardless
  -- of capture state (a not-yet-captured current card is still being shown).
  IF p_mark_presented THEN
    UPDATE public.match_review_queue_item
    SET presented_at = now(), updated_at = now()
    WHERE id = p_item_id
      AND presented_at IS NULL;
  END IF;

  -- =========================================================================
  -- PLAYLIST orientation: subject = playlist, suggestions = songs.
  -- Byte-parallel with present_match_review_item_fast's JSONB shape.
  -- =========================================================================
  IF v_item.orientation = 'playlist' THEN
    IF v_item.visible_pairs_captured_at IS NULL THEN
      RETURN jsonb_build_object('status', 'not_captured');
    END IF;

    -- Playlist lookup (account-scoped = ownership check).
    SELECT p.id, p.spotify_id, p.name, p.match_intent,
           p.image_url, p.song_count
    INTO v_playlist
    FROM public.playlist p
    WHERE p.id = v_item.playlist_id
      AND p.account_id = p_account_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'playlist_gone');
    END IF;

    -- Suggestion rows (songs) — display order fit_score DESC, model_rank ASC,
    -- stable song_id ASC; dismissed pairs excluded in SQL.
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

    -- Zero active rows: disambiguate empty capture vs all-dismissed.
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
  END IF;

  -- =========================================================================
  -- SONG orientation: subject = song, suggestions = playlists.
  -- Mirror of the playlist arm; top-level keys kept parallel.
  -- =========================================================================
  IF v_item.visible_pairs_captured_at IS NULL THEN
    RETURN jsonb_build_object('status', 'not_captured');
  END IF;

  -- Subject song lookup (songs are global, not account-scoped; a missing row is
  -- the song-arm equivalent of playlist_gone).
  SELECT s.id, s.spotify_id, s.name, s.artists, s.album_name,
         s.image_url, s.genres
  INTO v_song
  FROM public.song s
  WHERE s.id = v_item.song_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'song_gone');
  END IF;

  -- Decorative subject enrichment, folded in from fetchSongOrientationData so a
  -- song card renders from one round trip. song_audio_feature is UNIQUE(song_id);
  -- song_analysis takes the latest by created_at. Both are optional (nullable).
  SELECT af.tempo, af.energy, af.valence
  INTO v_audio
  FROM public.song_audio_feature af
  WHERE af.song_id = v_item.song_id;

  SELECT sa.analysis
  INTO v_analysis
  FROM public.song_analysis sa
  WHERE sa.song_id = v_item.song_id
  ORDER BY sa.created_at DESC
  LIMIT 1;

  -- Suggestion rows (playlists) — display order fit_score DESC, model_rank ASC,
  -- stable playlist_id ASC; dismissed pairs excluded in SQL (the vp row carries
  -- both song_id and playlist_id, so the exclusion predicate is identical).
  SELECT COALESCE(jsonb_agg(row_data ORDER BY rn), '[]'::JSONB),
         COALESCE(MAX(total_ct), 0)
  INTO v_suggestions, v_total_active
  FROM (
    SELECT
      jsonb_build_object(
        'playlist_id',  p.id,
        'name',         p.name,
        'match_intent', p.match_intent,
        'image_url',    p.image_url,
        'spotify_id',   p.spotify_id,
        'song_count',   p.song_count,
        'fit_score',    vp.fit_score,
        'visible_rank', vp.visible_rank,
        'model_rank',   vp.model_rank
      ) AS row_data,
      count(*) OVER () AS total_ct,
      row_number() OVER (
        ORDER BY vp.fit_score DESC, vp.model_rank ASC, vp.playlist_id ASC
      ) AS rn
    FROM public.match_review_item_visible_pair vp
    JOIN public.playlist p ON p.id = vp.playlist_id
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

  -- Zero active rows: disambiguate empty capture vs all-dismissed.
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
      'song_id', v_item.song_id,
      'state', v_item.state,
      'visible_pairs_captured_at', v_item.visible_pairs_captured_at
    ),
    'song', jsonb_build_object(
      'id', v_song.id,
      'spotify_id', v_song.spotify_id,
      'name', v_song.name,
      'artists', to_jsonb(v_song.artists),
      'album_name', v_song.album_name,
      'image_url', v_song.image_url,
      'genres', to_jsonb(v_song.genres),
      'audio_feature', CASE
        WHEN v_audio IS NULL THEN NULL
        ELSE jsonb_build_object(
          'tempo', v_audio.tempo,
          'energy', v_audio.energy,
          'valence', v_audio.valence
        )
      END,
      'analysis', v_analysis
    ),
    'suggestions', v_suggestions,
    'total_active_count', v_total_active
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.read_match_deck_card(UUID, UUID, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.read_match_deck_card(UUID, UUID, INTEGER, BOOLEAN)
  TO service_role;
