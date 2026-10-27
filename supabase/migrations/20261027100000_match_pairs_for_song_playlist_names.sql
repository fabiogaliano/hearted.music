-- get_match_pairs_for_song also returns each suggestion playlist's name and
-- Spotify id.
--
-- getSongSuggestions (liked-songs panel) used to read the names in a second
-- request, feeding the DB-derived playlist ids back as an .in() filter and
-- ignoring that request's error: a failed read made every suggestion vanish.
-- Joining here puts the names in the same read that produces the pairs, so a
-- failure is that read's error.
--
-- Adding columns changes the RETURNS TABLE type, which CREATE OR REPLACE
-- cannot do, so the function is dropped and recreated in this one transaction.
-- Callers that ignore the new columns (the deck paths) are unaffected.

DROP FUNCTION public.get_match_pairs_for_song(UUID, UUID);

CREATE FUNCTION public.get_match_pairs_for_song(
  p_snapshot_id UUID,
  p_song_id     UUID
) RETURNS TABLE (
  song_id             UUID,
  playlist_id         UUID,
  score               DOUBLE PRECISION,
  fused_score         DOUBLE PRECISION,
  playlist_name       TEXT,
  playlist_spotify_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mr.song_id, mr.playlist_id, mr.score, mr.fused_score, p.name, p.spotify_id
  FROM public.match_result mr
  JOIN public.playlist p ON p.id = mr.playlist_id
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

REVOKE EXECUTE ON FUNCTION public.get_match_pairs_for_song(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_match_pairs_for_song(UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
