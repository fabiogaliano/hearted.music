-- MSR review fix (Finding 1): orientation-aware playlist queue insertion.
--
-- appendSnapshotDelta could derive playlist-orientation subjects but had no
-- insert path for them: the only batch insert RPC was insert_queue_song_items,
-- which hard-codes orientation='song' and targets the song partial unique index.
-- Playlist sessions therefore filtered out every subject and recorded the
-- snapshot as applied with zero items, leaving playlist mode permanently empty.
--
-- This adds the playlist counterpart, mirroring insert_queue_song_items exactly
-- but writing playlist_id (song_id stays NULL, satisfying the exactly-one-subject
-- CHECK) and targeting the playlist partial unique index
-- idx_match_review_queue_item_session_playlist_subject (WHERE orientation =
-- 'playlist'). PostgREST cannot target partial indexes via onConflict, so an
-- explicit SQL path is required. Duplicate (session_id, playlist_id) rows are
-- silently skipped (ON CONFLICT DO NOTHING) so concurrent same-snapshot appends
-- stay idempotent without raising a ConstraintError.
--
-- Security hardening matches insert_queue_song_items and all sibling
-- SECURITY DEFINER RPCs (pinned search_path, REVOKE from PUBLIC/anon/
-- authenticated, GRANT to service_role).

CREATE OR REPLACE FUNCTION public.insert_queue_playlist_items(
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
    playlist_id,
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
    (item->>'playlist_id')::uuid,
    (item->>'source_snapshot_id')::uuid,
    (item->>'position')::integer,
    'playlist',
    'pending',
    (item->>'source_fit_score')::numeric,
    COALESCE((item->>'was_new_at_enqueue')::boolean, false)
  FROM jsonb_array_elements(p_items) AS item
  ON CONFLICT (session_id, playlist_id) WHERE orientation = 'playlist' DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_queue_playlist_items(UUID, UUID, JSONB)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.insert_queue_playlist_items(UUID, UUID, JSONB)
TO service_role;
