-- MSR-06 follow-up: update atomic decision RPCs to use the new lifecycle
-- state values introduced by the MSR-06 schema migration.
--
-- The queue item state constraint was changed from
--   ('pending', 'presented', 'completed', 'skipped', 'unavailable')
-- to
--   ('pending', 'active', 'resolved')
--
-- The three decision RPCs still reference the old values; this migration brings
-- them into alignment so SET state = 'completed' / 'skipped' no longer violates
-- the check constraint and the NOT IN guards correctly recognise 'active' items
-- as still actionable.

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

  -- 'active' is the new lifecycle state for a card whose visible suggestion list
  -- has been captured; actionable cards are still 'pending' or 'active'.
  IF v_item.state NOT IN ('pending', 'active') THEN
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

  INSERT INTO public.match_event (
    account_id,
    song_id,
    playlist_id,
    event,
    snapshot_id,
    served_rank,
    queue_item_id,
    session_id,
    occurred_at
  ) VALUES (
    p_account_id,
    v_item.song_id,
    p_playlist_id,
    'added',
    v_item.source_snapshot_id,
    p_served_rank,
    p_item_id,
    v_item.session_id,
    v_now
  );

  RETURN 'added';
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_match_review_item_atomic(
  p_item_id UUID,
  p_account_id UUID,
  p_decisions JSONB DEFAULT '[]'::JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.match_review_queue_item%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_decisions JSONB := COALESCE(p_decisions, '[]'::JSONB);
BEGIN
  IF jsonb_typeof(v_decisions) <> 'array' THEN
    RETURN 'invalid_input';
  END IF;

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

  -- Terminal state is 'resolved'; resolution column carries the outcome.
  UPDATE public.match_review_queue_item
  SET
    state = 'resolved',
    resolution = 'dismissed',
    resolved_at = v_now,
    updated_at = v_now
  WHERE id = v_item.id
    AND account_id = p_account_id;

  INSERT INTO public.match_decision (
    account_id,
    song_id,
    playlist_id,
    decision,
    decided_at,
    snapshot_id,
    served_rank,
    queue_item_id
  )
  SELECT
    p_account_id,
    v_item.song_id,
    decision_row.playlist_id,
    'dismissed',
    v_now,
    v_item.source_snapshot_id,
    decision_row.served_rank,
    p_item_id
  FROM jsonb_to_recordset(v_decisions) AS decision_row(
    playlist_id UUID,
    served_rank INTEGER
  )
  WHERE decision_row.playlist_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.playlist playlist_row
      WHERE playlist_row.id = decision_row.playlist_id
        AND playlist_row.account_id = p_account_id
    )
  ON CONFLICT (account_id, song_id, playlist_id) DO NOTHING;

  INSERT INTO public.match_event (
    account_id,
    song_id,
    playlist_id,
    event,
    snapshot_id,
    served_rank,
    queue_item_id,
    session_id,
    occurred_at
  )
  SELECT
    p_account_id,
    v_item.song_id,
    decision_row.playlist_id,
    'dismissed',
    v_item.source_snapshot_id,
    decision_row.served_rank,
    p_item_id,
    v_item.session_id,
    v_now
  FROM jsonb_to_recordset(v_decisions) AS decision_row(
    playlist_id UUID,
    served_rank INTEGER
  )
  WHERE decision_row.playlist_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.playlist playlist_row
      WHERE playlist_row.id = decision_row.playlist_id
        AND playlist_row.account_id = p_account_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.match_decision md
      WHERE md.queue_item_id = p_item_id
        AND md.account_id = p_account_id
        AND md.playlist_id = decision_row.playlist_id
        AND md.decision = 'added'
    );

  RETURN 'dismissed';
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
  v_strictness DOUBLE PRECISION;
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

  SELECT COUNT(*)::INTEGER
  INTO v_add_count
  FROM public.match_decision
  WHERE queue_item_id = p_item_id
    AND account_id = p_account_id
    AND decision = 'added';

  SELECT strictness_min_score
  INTO v_strictness
  FROM public.match_review_session
  WHERE id = v_item.session_id
    AND account_id = p_account_id;

  IF v_strictness IS NOT NULL THEN
    INSERT INTO public.match_event (
      account_id,
      song_id,
      playlist_id,
      event,
      snapshot_id,
      served_rank,
      queue_item_id,
      session_id,
      occurred_at
    )
    SELECT
      p_account_id,
      v_item.song_id,
      mr.playlist_id,
      'skipped',
      v_item.source_snapshot_id,
      mr.rank,
      p_item_id,
      v_item.session_id,
      v_now
    FROM public.match_result mr
    WHERE mr.snapshot_id = v_item.source_snapshot_id
      AND mr.song_id = v_item.song_id
      AND mr.score >= v_strictness
      AND EXISTS (
        SELECT 1
        FROM public.playlist playlist_row
        WHERE playlist_row.id = mr.playlist_id
          AND playlist_row.account_id = p_account_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.match_decision md
        WHERE md.account_id = p_account_id
          AND md.song_id = v_item.song_id
          AND md.playlist_id = mr.playlist_id
      );
  END IF;

  IF v_add_count > 0 THEN
    -- Terminal state is 'resolved'; resolution column carries the outcome.
    UPDATE public.match_review_queue_item
    SET
      state = 'resolved',
      resolution = 'added',
      resolved_at = v_now,
      updated_at = v_now
    WHERE id = p_item_id
      AND account_id = p_account_id;

    RETURN 'completed_added';
  END IF;

  UPDATE public.match_review_queue_item
  SET
    state = 'resolved',
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

REVOKE EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID, JSONB)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, INTEGER)
TO service_role;

GRANT EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID, JSONB)
TO service_role;

GRANT EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
TO service_role;
