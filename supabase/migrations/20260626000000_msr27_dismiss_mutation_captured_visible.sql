-- MSR-27: Replace dismiss_match_review_item_atomic with an orientation-aware
-- version that reads decisions from match_review_item_visible_pair (captured
-- at presentation time via presentMatchReviewItem) rather than accepting a
-- caller-supplied p_decisions JSONB.
--
-- Changes from the MSR-07 version:
--   • No p_decisions parameter — the RPC reads captured pairs as the authority
--     so ranks are never recomputed at dismiss time (acceptance: "ranks do not
--     re-dense during dismiss").
--   • Orientation-aware: song items use v_item.song_id as subject and
--     vp.playlist_id as suggestion; playlist items use v_item.playlist_id as
--     subject and vp.song_id as suggestion.
--   • served_orientation, model_rank, and visible_rank populated from captured
--     pair rows (acceptance: "events/decisions include served_orientation,
--     model_rank, and visible_rank").
--   • Pairs that already have an 'added' decision for this queue_item_id are
--     excluded so double-writing does not clobber add decisions with dismissed
--     (acceptance: "do not write dismissed decisions for pairs already added on
--     the same queue item").
--   • New status: no_captured_pairs — returned when no rows exist in
--     match_review_item_visible_pair for the item. This is the signal for the
--     TypeScript caller to surface derive-failed and not resolve the item.
--   • Fixes MSR-06 null-guard defect: orientation-aware column access ensures
--     v_item.song_id is never read for playlist items where it is NULL.
--
-- Security hardening matches all sibling SECURITY DEFINER RPCs.

DROP FUNCTION IF EXISTS public.dismiss_match_review_item_atomic(UUID, UUID, JSONB);

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
  v_count INTEGER;
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

  -- Guard: presentMatchReviewItem must have captured pairs before dismiss.
  -- Dismissing without captured rows would silently resolve the item with no
  -- decisions, permanently losing the user's action context and blocking retry.
  SELECT COUNT(*)::INTEGER
  INTO v_count
  FROM public.match_review_item_visible_pair
  WHERE queue_item_id = p_item_id;

  IF v_count = 0 THEN
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
