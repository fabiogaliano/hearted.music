-- Reliable write-time match exclusion set (replaces loadExclusionSet's app-side
-- multi-query flow).
--
-- loadExclusionSet built its "skip this (song, playlist) pair" set with three
-- separate PostgREST reads, the last of which re-entered a DB-derived playlist
-- id list as an .in("playlist_id", …) URL filter — the pattern the repo bans
-- (DB-derived id sets must never re-enter a query as .in() filters; push the
-- predicate into an RPC/join). It also ignored the read errors, so a truncated
-- or failed load silently produced a PARTIAL exclusion set and existing
-- playlist members / decided pairs leaked into the snapshot.
--
-- This RPC computes the whole set DB-side in one round trip: every decided pair
-- (match_decision, either decision) UNION every current membership pair
-- (playlist_song for the account's own playlists). UNION dedups the overlap.
-- The TS wrapper now surfaces an error instead of degrading to a partial set.

CREATE OR REPLACE FUNCTION public.list_account_match_exclusion_pairs(
  p_account_id UUID
) RETURNS TABLE (
  song_id     UUID,
  playlist_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Decided pairs (added or dismissed) — same rows loadExclusionSet pulled from
  -- match_decision, unfiltered by decision type.
  SELECT md.song_id, md.playlist_id
  FROM public.match_decision md
  WHERE md.account_id = p_account_id

  UNION

  -- Current membership: songs already in one of the account's own playlists.
  -- The join to playlist scopes by owner, replacing the old two-step
  -- "load playlist ids, then .in() them" flow.
  SELECT ps.song_id, ps.playlist_id
  FROM public.playlist_song ps
  JOIN public.playlist p ON p.id = ps.playlist_id
  WHERE p.account_id = p_account_id
$$;

REVOKE EXECUTE ON FUNCTION public.list_account_match_exclusion_pairs(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_account_match_exclusion_pairs(UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
