-- MSR review fix (Finding 2): distinguish "not captured yet" from "captured empty"
-- in finish_match_review_item_atomic and dismiss_match_review_item_atomic.
--
-- capture_match_review_item_visible_pairs_atomic supports an empty capture: it
-- stamps visible_pairs_captured_at and activates the item while inserting zero
-- match_review_item_visible_pair rows (status 'empty'). This is the state behind
-- an "unavailable / no visible suggestions" card.
--
-- Both finish and dismiss previously guarded on the *row count* in
-- match_review_item_visible_pair, returning 'no_captured_pairs' whenever it was
-- zero. That conflated "presentMatchReviewItem has not run" (captured_at IS NULL)
-- with "captured, but nothing was visible" (captured_at IS NOT NULL, zero rows).
-- The UI skip for an unavailable/empty card calls finish, so the card got stuck
-- forever: finish kept returning no_captured_pairs and the item never resolved.
--
-- Fix: guard on visible_pairs_captured_at IS NULL instead of the row count.
--   • captured_at IS NULL              -> 'no_captured_pairs' (present must run first)
--   • captured_at set, zero pair rows  -> resolve normally; the INSERT ... SELECT
--     over zero captured pairs writes no decisions/events, so finish resolves the
--     item as 'skipped' and dismiss as 'dismissed' with no match_event/
--     match_decision rows.
--   • captured_at set, >=1 pair rows   -> unchanged behaviour.
--
-- Bodies are otherwise identical to MSR-28 (finish) and MSR-27 (dismiss); only
-- the guard changes. Argument lists are unchanged so CREATE OR REPLACE is safe.

CREATE OR REPLACE FUNCTION public.finish_match_review_item_atomic(
  p_item_id    UUID,
  p_account_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        public.match_review_queue_item%ROWTYPE;
  v_now         TIMESTAMPTZ := now();
  v_add_count   INTEGER;
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

  -- Guard on capture having occurred, not on the row count. A captured-empty
  -- item (captured_at set, zero pair rows) is the unavailable/no-suggestions
  -- card; finishing it is a legitimate skip and must resolve, writing no events.
  -- Only an item that was never presented (captured_at IS NULL) blocks finish.
  IF v_item.visible_pairs_captured_at IS NULL THEN
    RETURN 'no_captured_pairs';
  END IF;

  -- Count add decisions scoped to this queue item only. Scoping prevents adds
  -- from a prior session on the same (song, playlist) pair from incorrectly
  -- blocking a skip event on the current item.
  SELECT COUNT(*)::INTEGER
  INTO v_add_count
  FROM public.match_decision
  WHERE queue_item_id = p_item_id
    AND account_id    = p_account_id
    AND decision      = 'added';

  -- Resolve the item before writing skip events so that concurrent add mutations
  -- (which also take FOR UPDATE on the same row) serialize correctly — only one
  -- terminal state can win the lock.
  IF v_add_count > 0 THEN
    UPDATE public.match_review_queue_item
    SET
      state       = 'resolved',
      resolution  = 'added',
      resolved_at = v_now,
      updated_at  = v_now
    WHERE id = v_item.id
      AND account_id = p_account_id;
  ELSE
    UPDATE public.match_review_queue_item
    SET
      state       = 'resolved',
      resolution  = 'skipped',
      resolved_at = v_now,
      updated_at  = v_now
    WHERE id = v_item.id
      AND account_id = p_account_id;
  END IF;

  IF v_item.orientation = 'song' THEN
    -- Song orientation: subject = song (v_item.song_id), suggestion = playlist.
    -- Write skip events for all captured pairs that were NOT added on this item.
    -- Skips are events (never decisions) so the pair can resurface in later snapshots.
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
    )
    SELECT
      p_account_id,
      v_item.song_id,
      vp.playlist_id,
      'skipped',
      v_item.source_snapshot_id,
      vp.model_rank,
      vp.visible_rank,
      v_item.orientation,
      p_item_id,
      v_item.session_id,
      v_now
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = v_item.song_id
          AND md.playlist_id   = vp.playlist_id
          AND md.decision      = 'added'
      );

  ELSE
    -- Playlist orientation: subject = playlist (v_item.playlist_id), suggestion = song.
    -- MSR-06 null-guard: v_item.song_id is NULL for playlist items so it must
    -- never be used here — use v_item.playlist_id as the subject column instead.
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
    )
    SELECT
      p_account_id,
      vp.song_id,
      v_item.playlist_id,
      'skipped',
      v_item.source_snapshot_id,
      vp.model_rank,
      vp.visible_rank,
      v_item.orientation,
      p_item_id,
      v_item.session_id,
      v_now
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = vp.song_id
          AND md.playlist_id   = v_item.playlist_id
          AND md.decision      = 'added'
      );
  END IF;

  IF v_add_count > 0 THEN
    RETURN 'completed_added';
  END IF;
  RETURN 'skipped';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.dismiss_match_review_item_atomic(
  p_item_id    UUID,
  p_account_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item  public.match_review_queue_item%ROWTYPE;
  v_now   TIMESTAMPTZ := now();
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

  -- Guard on capture having occurred, not on the row count (see finish above).
  -- A captured-empty item has no pairs to dismiss, so it resolves as 'dismissed'
  -- with no decision/event rows; only a never-presented item (captured_at NULL)
  -- blocks dismiss so it can be retried after presentation.
  IF v_item.visible_pairs_captured_at IS NULL THEN
    RETURN 'no_captured_pairs';
  END IF;

  -- Resolve the item as dismissed before writing decisions so that concurrent
  -- add mutations (which also take FOR UPDATE on the same row) serialize
  -- correctly — only one terminal state can win the lock.
  UPDATE public.match_review_queue_item
  SET
    state       = 'resolved',
    resolution  = 'dismissed',
    resolved_at = v_now,
    updated_at  = v_now
  WHERE id = v_item.id
    AND account_id = p_account_id;

  IF v_item.orientation = 'song' THEN
    -- Song orientation: subject = song (v_item.song_id), suggestion = playlist.
    -- Ranks come from the captured pair rows — never recomputed at dismiss time.
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
    )
    SELECT
      p_account_id,
      v_item.song_id,
      vp.playlist_id,
      'dismissed',
      v_now,
      v_item.source_snapshot_id,
      vp.model_rank,
      vp.visible_rank,
      v_item.orientation,
      p_item_id
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = v_item.song_id
          AND md.playlist_id   = vp.playlist_id
          AND md.decision      = 'added'
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
    )
    SELECT
      p_account_id,
      v_item.song_id,
      vp.playlist_id,
      'dismissed',
      v_item.source_snapshot_id,
      vp.model_rank,
      vp.visible_rank,
      v_item.orientation,
      p_item_id,
      v_item.session_id,
      v_now
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = v_item.song_id
          AND md.playlist_id   = vp.playlist_id
          AND md.decision      = 'added'
      );

  ELSE
    -- Playlist orientation: subject = playlist (v_item.playlist_id), suggestion = song.
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
    )
    SELECT
      p_account_id,
      vp.song_id,
      v_item.playlist_id,
      'dismissed',
      v_now,
      v_item.source_snapshot_id,
      vp.model_rank,
      vp.visible_rank,
      v_item.orientation,
      p_item_id
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = vp.song_id
          AND md.playlist_id   = v_item.playlist_id
          AND md.decision      = 'added'
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
    )
    SELECT
      p_account_id,
      vp.song_id,
      v_item.playlist_id,
      'dismissed',
      v_item.source_snapshot_id,
      vp.model_rank,
      vp.visible_rank,
      v_item.orientation,
      p_item_id,
      v_item.session_id,
      v_now
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = vp.song_id
          AND md.playlist_id   = v_item.playlist_id
          AND md.decision      = 'added'
      );
  END IF;

  RETURN 'dismissed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID)
  TO service_role;
