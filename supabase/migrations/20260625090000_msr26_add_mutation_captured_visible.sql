-- MSR-26: Replace add_match_review_item_decision_atomic with an orientation-aware
-- version that validates the target against captured visible pairs instead of
-- recomputing from the snapshot.
--
-- The old 4-arg signature (UUID, UUID, UUID, INTEGER) is dropped and replaced
-- with a 4-arg signature (UUID, UUID, UUID DEFAULT NULL, UUID DEFAULT NULL)
-- where the two optional args carry the suggestion side of the pair, orientation-
-- aware. The RPC derives song_id / playlist_id from the locked item row so the
-- caller cannot supply the subject side directly.
--
-- New statuses:
--   not_visible    — the requested pair was not found in match_review_item_visible_pair.
--   invalid_target — the caller supplied the wrong suggestion column for the item's
--                    orientation (song item + song suggestion, or vice versa).
--
-- This also fixes the MSR-06 null-guard defect: ownership checks are now
-- orientation-aware (the right column is always non-null for the check).

DROP FUNCTION IF EXISTS public.add_match_review_item_decision_atomic(UUID, UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.add_match_review_item_decision_atomic(
  p_item_id              UUID,
  p_account_id           UUID,
  p_suggestion_song_id     UUID DEFAULT NULL,
  p_suggestion_playlist_id UUID DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item      public.match_review_queue_item%ROWTYPE;
  v_pair      public.match_review_item_visible_pair%ROWTYPE;
  v_now       TIMESTAMPTZ := now();
  v_song_id   UUID;
  v_playlist_id UUID;
BEGIN
  SELECT *
  INTO v_item
  FROM public.match_review_queue_item
  WHERE id = p_item_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_item.state NOT IN ('pending', 'active') THEN
    RETURN 'already_resolved';
  END IF;

  -- Validate target shape matches the item's orientation: only the suggestion
  -- side should be supplied; supplying the subject side is an invalid call.
  IF v_item.orientation = 'song' THEN
    -- Song items: subject is song_id (from the item row). The suggestion must
    -- be a playlist. Callers must supply p_suggestion_playlist_id, not song.
    IF p_suggestion_playlist_id IS NULL THEN
      RETURN 'invalid_target';
    END IF;
  ELSE
    -- Playlist items: subject is playlist_id. The suggestion must be a song.
    IF p_suggestion_song_id IS NULL THEN
      RETURN 'invalid_target';
    END IF;
  END IF;

  -- Look up the captured visible pair for this exact (item, subject, suggestion)
  -- combination. The pair must have been captured by presentMatchReviewItem before
  -- the add mutation can succeed — this is the source of truth for ranks.
  IF v_item.orientation = 'song' THEN
    SELECT *
    INTO v_pair
    FROM public.match_review_item_visible_pair
    WHERE queue_item_id = p_item_id
      AND song_id       = v_item.song_id
      AND playlist_id   = p_suggestion_playlist_id;
  ELSE
    SELECT *
    INTO v_pair
    FROM public.match_review_item_visible_pair
    WHERE queue_item_id = p_item_id
      AND song_id       = p_suggestion_song_id
      AND playlist_id   = v_item.playlist_id;
  END IF;

  IF NOT FOUND THEN
    RETURN 'not_visible';
  END IF;

  -- Verify ownership and entitlement, orientation-aware. This fixes the MSR-06
  -- null-guard defect where the song-mode path checked `v_item.song_id` even for
  -- playlist items where that column is null.
  IF v_item.orientation = 'song' THEN
    -- The suggestion is the playlist; it must belong to the account.
    IF NOT EXISTS (
      SELECT 1 FROM public.playlist
      WHERE id = p_suggestion_playlist_id AND account_id = p_account_id
    ) THEN
      RETURN 'foreign_playlist';
    END IF;
    -- The subject song must be entitled.
    IF COALESCE(public.is_account_song_entitled(p_account_id, v_item.song_id), FALSE) IS NOT TRUE THEN
      RETURN 'not_entitled';
    END IF;
    v_song_id     := v_item.song_id;
    v_playlist_id := p_suggestion_playlist_id;
  ELSE
    -- The subject is the playlist; it must belong to the account.
    IF NOT EXISTS (
      SELECT 1 FROM public.playlist
      WHERE id = v_item.playlist_id AND account_id = p_account_id
    ) THEN
      RETURN 'foreign_playlist';
    END IF;
    -- The suggestion song must be entitled.
    IF COALESCE(public.is_account_song_entitled(p_account_id, p_suggestion_song_id), FALSE) IS NOT TRUE THEN
      RETURN 'not_entitled';
    END IF;
    v_song_id     := p_suggestion_song_id;
    v_playlist_id := v_item.playlist_id;
  END IF;

  -- Write the add decision using ranks from the captured visible pair. This
  -- ensures model_rank and visible_rank are always consistent with what the
  -- user actually saw, regardless of any subsequent snapshot changes.
  INSERT INTO public.match_decision (
    account_id,
    song_id,
    playlist_id,
    decision,
    decided_at,
    snapshot_id,
    model_rank,
    visible_rank,
    served_orientation,
    queue_item_id
  ) VALUES (
    p_account_id,
    v_song_id,
    v_playlist_id,
    'added',
    v_now,
    v_item.source_snapshot_id,
    v_pair.model_rank,
    v_pair.visible_rank,
    v_item.orientation,
    p_item_id
  )
  ON CONFLICT (account_id, song_id, playlist_id) DO UPDATE SET
    decision           = EXCLUDED.decision,
    decided_at         = EXCLUDED.decided_at,
    snapshot_id        = EXCLUDED.snapshot_id,
    model_rank         = EXCLUDED.model_rank,
    visible_rank       = EXCLUDED.visible_rank,
    served_orientation = EXCLUDED.served_orientation,
    queue_item_id      = EXCLUDED.queue_item_id;

  INSERT INTO public.match_event (
    account_id,
    song_id,
    playlist_id,
    event,
    snapshot_id,
    model_rank,
    visible_rank,
    served_orientation,
    queue_item_id,
    session_id,
    occurred_at
  ) VALUES (
    p_account_id,
    v_song_id,
    v_playlist_id,
    'added',
    v_item.source_snapshot_id,
    v_pair.model_rank,
    v_pair.visible_rank,
    v_item.orientation,
    p_item_id,
    v_item.session_id,
    v_now
  );

  RETURN 'added';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, UUID)
  TO service_role;
