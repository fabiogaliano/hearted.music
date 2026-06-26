-- MSR-28: Replace finish_match_review_item_atomic with an orientation-aware
-- version that reads skip context from match_review_item_visible_pair (captured
-- at presentation time via presentMatchReviewItem) rather than querying
-- match_result directly.
--
-- Changes from the original version (20260616131000):
--   • Checks pending|active (B9-C lifecycle, not pending|presented).
--   • no_captured_pairs guard — requires presentMatchReviewItem to have captured
--     pairs before finish can proceed; mirrors the dismiss RPC guard (MSR-27).
--   • Writes skip EVENTS (not decisions) for all captured pairs without an add
--     decision on this queue_item_id. Skip logs event history; it never writes
--     to match_decision (which is the exclusion source).
--   • Add-decision lookup is scoped to queue_item_id to avoid suppressing events
--     from prior-session adds incorrectly (acceptance: "avoid suppressing events
--     from prior sessions incorrectly").
--   • Resolution is state='resolved', resolution='added'|'skipped' (B9-C).
--   • Orientation-aware: song items use v_item.song_id as subject and
--     vp.playlist_id as suggestion; playlist items use v_item.playlist_id as
--     subject and vp.song_id as suggestion.
--   • served_orientation, model_rank, visible_rank populated from captured pair
--     rows so ranks are never recomputed at finish time.
--   • Fixes MSR-06 null-guard defect: orientation-aware column access ensures
--     v_item.song_id is never read for playlist items where it is NULL.
--
-- The argument list is unchanged (UUID, UUID), so CREATE OR REPLACE is safe.
-- Security hardening matches all sibling SECURITY DEFINER RPCs.

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
  v_pair_count  INTEGER;
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

  -- Guard: presentMatchReviewItem must have captured pairs before finish.
  -- Finishing without captured rows would silently resolve the item with no
  -- skip events, permanently losing the user's view context and blocking retry.
  SELECT COUNT(*)::INTEGER
  INTO v_pair_count
  FROM public.match_review_item_visible_pair
  WHERE queue_item_id = p_item_id;

  IF v_pair_count = 0 THEN
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
