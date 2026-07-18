-- Quick-picks source for the seed-template artist blank (playlist creation beat 1).
--
-- Aggregates artist credits across an account's still-liked songs so the
-- "Around [artist]" seed template offers artists the user actually owns, ranked
-- by how many liked songs credit them. unnest expands each song's artists array
-- (names); the GROUP BY counts credits per name — a song crediting two artists
-- contributes to both. Mirrors get_account_top_genres exactly (same population,
-- same shape); artists is a TEXT[] of names, like genres.
--
-- Backend-private: callable only through the service-role client (same posture
-- as the other public-schema RPCs).

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
  SELECT a AS artist, COUNT(*)::BIGINT AS occurrences
  FROM liked_song ls
  JOIN song s ON s.id = ls.song_id
  CROSS JOIN LATERAL unnest(s.artists) AS a
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
  GROUP BY a
  ORDER BY occurrences DESC, a ASC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.get_account_top_artists(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_account_top_artists(UUID, INTEGER)
  TO service_role;
