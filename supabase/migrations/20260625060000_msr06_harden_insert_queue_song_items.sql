-- MSR-06 security hardening: pin search_path on insert_queue_song_items.
--
-- The original migration (20260625030000) declared this function as SECURITY
-- DEFINER but omitted SET search_path, leaving it open to search_path
-- injection. All sibling SECURITY DEFINER functions in this codebase pin
-- search_path = public (see 20260519110000_harden_internal_rpcs.sql and
-- 20260625020000_msr06_rpc_lifecycle_state.sql for the canonical pattern).
--
-- This migration re-creates the function with the missing pin and adds the
-- standard REVOKE/GRANT hardening so it is only callable via service_role.
-- The original migration file is left untouched (already applied).

CREATE OR REPLACE FUNCTION public.insert_queue_song_items(
  p_session_id uuid,
  p_account_id uuid,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.match_review_queue_item (
    session_id,
    account_id,
    song_id,
    source_snapshot_id,
    position,
    orientation,
    state,
    source_fit_score,
    was_new_at_enqueue
  )
  SELECT
    p_session_id,
    p_account_id,
    (item->>'song_id')::uuid,
    (item->>'source_snapshot_id')::uuid,
    (item->>'position')::integer,
    'song',
    'pending',
    (item->>'source_fit_score')::numeric,
    COALESCE((item->>'was_new_at_enqueue')::boolean, false)
  FROM jsonb_array_elements(p_items) AS item
  ON CONFLICT (session_id, song_id) WHERE orientation = 'song' DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_queue_song_items(UUID, UUID, JSONB)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.insert_queue_song_items(UUID, UUID, JSONB)
TO service_role;
