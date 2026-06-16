-- Serializes add and finish against the same queue row so finish cannot mark a
-- card skipped while an add decision is still in flight, and stale adds cannot
-- write decisions after finish/dismiss has resolved the item.

CREATE OR REPLACE FUNCTION public.add_match_review_item_decision_atomic(
  p_item_id UUID,
  p_account_id UUID,
  p_playlist_id UUID,
  p_served_rank INTEGER DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.match_review_queue_item%ROWTYPE;
  v_now TIMESTAMPTZ := now();
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

  IF v_item.state NOT IN ('pending', 'presented') THEN
    RETURN 'already_resolved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.playlist playlist_row
    WHERE playlist_row.id = p_playlist_id
      AND playlist_row.account_id = p_account_id
  ) THEN
    RETURN 'foreign_playlist';
  END IF;

  IF COALESCE(public.is_account_song_entitled(p_account_id, v_item.song_id), FALSE) IS NOT TRUE THEN
    RETURN 'not_entitled';
  END IF;

  INSERT INTO public.match_decision (
    account_id,
    song_id,
    playlist_id,
    decision,
    decided_at,
    snapshot_id,
    served_rank,
    queue_item_id
  ) VALUES (
    p_account_id,
    v_item.song_id,
    p_playlist_id,
    'added',
    v_now,
    v_item.source_snapshot_id,
    p_served_rank,
    p_item_id
  )
  ON CONFLICT (account_id, song_id, playlist_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    decided_at = EXCLUDED.decided_at,
    snapshot_id = EXCLUDED.snapshot_id,
    served_rank = EXCLUDED.served_rank,
    queue_item_id = EXCLUDED.queue_item_id;

  RETURN 'added';
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_match_review_item_atomic(
  p_item_id UUID,
  p_account_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.match_review_queue_item%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_add_count INTEGER := 0;
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

  IF v_item.state NOT IN ('pending', 'presented') THEN
    RETURN 'already_resolved';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_add_count
  FROM public.match_decision
  WHERE queue_item_id = p_item_id
    AND account_id = p_account_id
    AND decision = 'added';

  IF v_add_count > 0 THEN
    UPDATE public.match_review_queue_item
    SET
      state = 'completed',
      resolution = 'added',
      resolved_at = v_now,
      updated_at = v_now
    WHERE id = p_item_id
      AND account_id = p_account_id;

    RETURN 'completed_added';
  END IF;

  UPDATE public.match_review_queue_item
  SET
    state = 'skipped',
    resolution = 'skipped',
    resolved_at = v_now,
    updated_at = v_now
  WHERE id = p_item_id
    AND account_id = p_account_id;

  RETURN 'skipped';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, INTEGER)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, INTEGER)
TO service_role;

GRANT EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
TO service_role;
