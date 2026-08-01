-- Artist browse counts across the playlist-creation flow become promises, not
-- stats. get_account_top_artists previously aggregated over all active likes,
-- while the studio can only place the 10,000 most-recent Phase-1 enriched likes.
-- Keep this population in lockstep with the search and artist-resolution RPCs
-- and src/lib/domains/playlists/candidate-loader.ts.
--
-- Backend-private posture unchanged: service-role only. Signatures and result
-- shapes are unchanged, so no regenerated types are needed.

CREATE OR REPLACE FUNCTION get_account_top_artists(
  p_account_id UUID,
  p_limit      INTEGER DEFAULT 12
)
RETURNS TABLE (artist TEXT, occurrences BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent_likes AS (
    SELECT ls.song_id
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
    ORDER BY ls.liked_at DESC, ls.song_id ASC
    LIMIT 10000
  )
  SELECT a AS artist, COUNT(*)::BIGINT AS occurrences
  FROM recent_likes rl
  JOIN song s ON s.id = rl.song_id
  CROSS JOIN LATERAL unnest(s.artists) AS a
  WHERE (
    cardinality(s.genres) > 0
    OR EXISTS (SELECT 1 FROM song_audio_feature f WHERE f.song_id = s.id)
  )
  GROUP BY a
  ORDER BY occurrences DESC, a ASC
  LIMIT p_limit;
$$;
