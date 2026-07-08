-- Push the "song already in the playlist" exclusion into the candidate-pair
-- read itself, so it holds for every caller with no extra reads.
--
-- getMatchPairsForSong / getMatchPairsForPlaylist previously selected straight
-- from match_result. The pre-capture membership filter added earlier fetched a
-- playlist's whole song set (or a song's whole playlist set) into the app just
-- to drop the members — thousands of rows to filter a few hundred candidates,
-- and the song arm read cross-account.
--
-- These RPCs read the same columns/order but anti-join playlist_song, so
-- Postgres probes membership only for the actual candidate pairs via the
-- UNIQUE(playlist_id, song_id) index. The invariant becomes:
--
--   get_match_pairs_for_song / get_match_pairs_for_playlist never return a pair
--   whose song is already in the playlist.
--
-- Every caller benefits — including getSongSuggestions (matching.functions.ts),
-- which reads getMatchPairsForSong directly and is not behind the deck-card
-- read RPCs. The read-time deck-card / tail-page filters stay as the race /
-- stale-snapshot safety net.

CREATE OR REPLACE FUNCTION public.get_match_pairs_for_song(
  p_snapshot_id UUID,
  p_song_id     UUID
) RETURNS TABLE (
  song_id     UUID,
  playlist_id UUID,
  score       DOUBLE PRECISION,
  fused_score DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mr.song_id, mr.playlist_id, mr.score, mr.fused_score
  FROM public.match_result mr
  WHERE mr.snapshot_id = p_snapshot_id
    AND mr.song_id = p_song_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.playlist_song ps
      WHERE ps.playlist_id = mr.playlist_id
        AND ps.song_id = mr.song_id
    )
  ORDER BY mr.score DESC, mr.playlist_id ASC
$$;

CREATE OR REPLACE FUNCTION public.get_match_pairs_for_playlist(
  p_snapshot_id UUID,
  p_playlist_id UUID
) RETURNS TABLE (
  song_id     UUID,
  playlist_id UUID,
  score       DOUBLE PRECISION,
  fused_score DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mr.song_id, mr.playlist_id, mr.score, mr.fused_score
  FROM public.match_result mr
  WHERE mr.snapshot_id = p_snapshot_id
    AND mr.playlist_id = p_playlist_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.playlist_song ps
      WHERE ps.playlist_id = mr.playlist_id
        AND ps.song_id = mr.song_id
    )
  ORDER BY mr.score DESC, mr.song_id ASC
$$;

REVOKE EXECUTE ON FUNCTION public.get_match_pairs_for_song(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_match_pairs_for_playlist(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_match_pairs_for_song(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_match_pairs_for_playlist(UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
