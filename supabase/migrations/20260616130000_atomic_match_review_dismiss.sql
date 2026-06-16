-- Resolves a dismiss and writes its negative decisions in a single transaction.
-- The queue row is locked first, so stale dismisses that lose a finish/dismiss race
-- return already_resolved without touching match_decision.

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

  IF v_item.state NOT IN ('pending', 'presented') THEN
    RETURN 'already_resolved';
  END IF;

  UPDATE public.match_review_queue_item
  SET
    state = 'completed',
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

  RETURN 'dismissed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID, JSONB)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID, JSONB)
TO service_role;
