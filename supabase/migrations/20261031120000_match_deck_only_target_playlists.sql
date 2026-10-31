-- The review deck only suggests playlists that are still in matching.
--
-- Bug: a song-mode card kept suggesting a playlist months after the user took
-- it out of matching (is_target = false). A queue item scores against the
-- snapshot it was enqueued from, and its visible pairs are frozen at capture,
-- so neither path saw the playlist leave. Freezing is deliberate (decisions
-- are made against a stable list within a pass), but matching only ever
-- covers target playlists, so target status is checked against the live
-- playlist row, the same way 20260708000022 checks dismissals and membership.
--
-- read_match_deck_card (full body from 20260708000022):
--   playlist arm: a subject playlist out of matching reads as playlist_gone.
--   song arm:     suggestions skip playlists out of matching, and the
--                 empty-capture check counts only target-playlist pairs, so a
--                 card left with none resolves as no_visible_suggestions
--                 instead of an empty ready card.
-- select_match_visibility_inputs (full body from 20261028120000): pairs for
--   playlists out of matching are dropped, so queue eligibility and new
--   captures never see them.

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

    -- M6: clear song newness the same way the legacy clearSongNewness did.
    -- Song-keyed only — a playlist subject has no account_item_newness row to
    -- clear. Idempotent upsert (ON CONFLICT DO UPDATE), safe to run on every
    -- presented read, not just the first.
    IF v_item.orientation = 'song' THEN
      INSERT INTO public.account_item_newness (
        account_id, item_type, item_id, is_new, viewed_at
      ) VALUES (
        p_account_id, 'song', v_item.song_id, false, now()
      )
      ON CONFLICT (account_id, item_type, item_id) DO UPDATE SET
        is_new = false,
        viewed_at = EXCLUDED.viewed_at;
    END IF;
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
      AND p.account_id = p_account_id
      AND p.is_target;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'playlist_gone');
    END IF;

    -- Suggestion rows (songs) — display order fit_score DESC, model_rank ASC,
    -- stable song_id ASC; dismissed pairs and current playlist members excluded
    -- in SQL.
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
        AND NOT EXISTS (
          SELECT 1
          FROM public.playlist_song ps
          WHERE ps.playlist_id = vp.playlist_id
            AND ps.song_id     = vp.song_id
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
  -- Playlists that already contain the subject song are excluded too — the
  -- mirror of the playlist arm's membership filter.
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
      AND p.is_target
      AND NOT EXISTS (
        SELECT 1
        FROM public.match_decision d
        WHERE d.account_id  = p_account_id
          AND d.song_id     = vp.song_id
          AND d.playlist_id = vp.playlist_id
          AND d.decision    = 'dismissed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.playlist_song ps
        WHERE ps.playlist_id = vp.playlist_id
          AND ps.song_id     = vp.song_id
      )
  ) sub
  WHERE rn <= COALESCE(p_limit, 2147483647);

  -- Zero active rows: disambiguate empty capture vs all-dismissed.
  IF v_total_active = 0 THEN
    SELECT count(*)
    INTO v_captured_ct
    FROM public.match_review_item_visible_pair vp
    JOIN public.playlist p ON p.id = vp.playlist_id
    WHERE vp.queue_item_id = p_item_id
      AND vp.account_id = p_account_id
      AND p.is_target;

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

CREATE OR REPLACE FUNCTION public.select_match_visibility_inputs(
  p_account_id          UUID,
  p_snapshot_id         UUID,
  p_song_id             UUID DEFAULT NULL,
  p_playlist_id         UUID DEFAULT NULL,
  p_after_song_id       UUID DEFAULT NULL,
  p_after_playlist_id   UUID DEFAULT NULL
) RETURNS TABLE (
  song_id             UUID,
  playlist_id         UUID,
  score               DOUBLE PRECISION,
  fused_score         DOUBLE PRECISION,
  song_entitled       BOOLEAN,
  playlist_owned      BOOLEAN,
  decided             BOOLEAN,
  language            TEXT,
  language_secondary  TEXT,
  release_year        INTEGER,
  vocal_gender        TEXT,
  liked_at            TIMESTAMPTZ,
  match_filters       JSONB,
  playlist_name       TEXT,
  playlist_spotify_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pairs AS (
    SELECT mr.song_id, mr.playlist_id, mr.score, mr.fused_score
    FROM public.match_result mr
    JOIN public.match_snapshot ms ON ms.id = mr.snapshot_id
    JOIN public.playlist tp ON tp.id = mr.playlist_id
    WHERE mr.snapshot_id = p_snapshot_id
      AND ms.account_id = p_account_id
      AND tp.is_target
      AND (p_song_id IS NULL OR mr.song_id = p_song_id)
      AND (p_playlist_id IS NULL OR mr.playlist_id = p_playlist_id)
      AND (
        p_after_song_id IS NULL
        OR (mr.song_id, mr.playlist_id) > (p_after_song_id, p_after_playlist_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.playlist_song ps
        WHERE ps.playlist_id = mr.playlist_id
          AND ps.song_id = mr.song_id
      )
  ),
  -- Passing the pair songs keeps the entitlement check to the snapshot's songs
  -- instead of the whole library.
  entitled AS (
    SELECT e.song_id
    FROM public.select_entitled_data_enriched_liked_song_ids(
      p_account_id,
      ARRAY(SELECT DISTINCT pairs.song_id FROM pairs)
    ) e
  )
  SELECT
    p.song_id,
    p.playlist_id,
    p.score,
    p.fused_score,
    e.song_id IS NOT NULL,
    pl.account_id = p_account_id,
    EXISTS (
      SELECT 1
      FROM public.match_decision md
      WHERE md.account_id = p_account_id
        AND md.song_id = p.song_id
        AND md.playlist_id = p.playlist_id
    ),
    s.language,
    s.language_secondary,
    s.release_year::INTEGER,
    s.vocal_gender,
    ls.liked_at,
    pl.match_filters,
    pl.name,
    pl.spotify_id
  FROM pairs p
  JOIN public.song s ON s.id = p.song_id
  JOIN public.playlist pl ON pl.id = p.playlist_id
  LEFT JOIN entitled e ON e.song_id = p.song_id
  LEFT JOIN public.liked_song ls
    ON ls.account_id = p_account_id
   AND ls.song_id = p.song_id
   AND ls.unliked_at IS NULL
$$;

REVOKE EXECUTE ON FUNCTION public.select_match_visibility_inputs(UUID, UUID, UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.select_match_visibility_inputs(UUID, UUID, UUID, UUID, UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
