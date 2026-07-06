-- Single-RPC resume path for /match bootstrap.
--
-- Collapses the 6 serial PostgREST round trips of the common "session exists,
-- latest snapshot already applied" resume case into one database call. Returns
-- a JSONB payload containing the active session, unresolved count, latest
-- snapshot id, applied snapshot keys, and the full queue item list. TypeScript
-- computes the visibility hash client-side and checks the applied set; if the
-- snapshot is already applied the bootstrap is done in 1 round trip.
--
-- When no active session exists, returns {"status":"no_session"} so the caller
-- falls through to session creation in TypeScript.

CREATE OR REPLACE FUNCTION public.resume_match_review_session(
  p_account_id   UUID,
  p_orientation  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session       RECORD;
  v_unresolved    BIGINT;
  v_latest_snap   UUID;
  v_applied       JSONB;
  v_items         JSONB;
BEGIN
  -- 1. Active session lookup
  SELECT id, account_id, orientation, status,
         strictness_preset, strictness_min_score,
         created_at, updated_at, completed_at
  INTO v_session
  FROM public.match_review_session
  WHERE account_id = p_account_id
    AND orientation = p_orientation
    AND status = 'active'
  -- Legacy fetchActiveSession uses .maybeSingle(), which errors on duplicates.
  -- The one-active-per-orientation partial index should make this a single row,
  -- but ORDER BY makes the pick deterministic if that invariant is ever violated.
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_session');
  END IF;

  -- 2. Count unresolved (pending + active) items
  SELECT count(*)
  INTO v_unresolved
  FROM public.match_review_queue_item
  WHERE session_id = v_session.id
    AND state IN ('pending', 'active');

  -- 3. Latest snapshot for the account
  SELECT ms.id
  INTO v_latest_snap
  FROM public.match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
  LIMIT 1;

  -- 4. Applied snapshot keys (small set — typically 1-3 rows per session)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'snapshot_id', ss.snapshot_id,
      'visibility_config_hash', ss.visibility_config_hash
    )
  ), '[]'::JSONB)
  INTO v_applied
  FROM public.match_review_session_snapshot ss
  WHERE ss.session_id = v_session.id;

  -- 5. Queue items ordered by position — same column set as fetchQueueItems
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', qi.id,
      'session_id', qi.session_id,
      'account_id', qi.account_id,
      'orientation', qi.orientation,
      'song_id', qi.song_id,
      'playlist_id', qi.playlist_id,
      'source_snapshot_id', qi.source_snapshot_id,
      'position', qi.position,
      'state', qi.state,
      'resolution', qi.resolution,
      'source_fit_score', qi.source_fit_score,
      'was_new_at_enqueue', qi.was_new_at_enqueue,
      'presented_at', qi.presented_at,
      'resolved_at', qi.resolved_at,
      'visible_pairs_captured_at', qi.visible_pairs_captured_at,
      'created_at', qi.created_at,
      'updated_at', qi.updated_at
    ) ORDER BY qi.position ASC
  ), '[]'::JSONB)
  INTO v_items
  FROM public.match_review_queue_item qi
  WHERE qi.session_id = v_session.id;

  RETURN jsonb_build_object(
    'status', 'found',
    'session', jsonb_build_object(
      'id', v_session.id,
      'account_id', v_session.account_id,
      'orientation', v_session.orientation,
      'status', v_session.status,
      'strictness_preset', v_session.strictness_preset,
      'strictness_min_score', v_session.strictness_min_score,
      'created_at', v_session.created_at,
      'updated_at', v_session.updated_at,
      'completed_at', v_session.completed_at
    ),
    'unresolved_count', v_unresolved,
    'latest_snapshot_id', v_latest_snap,
    'applied_snapshots', v_applied,
    'items', v_items
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resume_match_review_session(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resume_match_review_session(UUID, TEXT)
  TO service_role;
