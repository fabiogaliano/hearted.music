-- Type-to-search source for the studio's ArtistConfig panel (playlist creation).
--
-- get_account_top_artists truncates to the top-N artists BEFORE any text match
-- runs, so in a library with more distinct artists than the pool cap the
-- less-liked ones are unfindable no matter what the user types. This sibling
-- pushes the name predicate into the aggregation itself: the match runs over
-- ALL of the account's still-liked artists and only the result is limited.
-- Same population and credit semantics as get_account_top_artists (a song
-- crediting two artists counts for both).
--
-- p_query must arrive with ILIKE metacharacters (\ % _) already escaped by the
-- caller; the default backslash escape applies. An empty p_query degenerates
-- to the ranked browse aggregate.
--
-- Backend-private: callable only through the service-role client (same posture
-- as the other public-schema RPCs).

CREATE OR REPLACE FUNCTION search_account_liked_artists(
  p_account_id UUID,
  p_query      TEXT    DEFAULT '',
  p_limit      INTEGER DEFAULT 50
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
    AND (p_query = '' OR a ILIKE '%' || p_query || '%')
  GROUP BY a
  ORDER BY occurrences DESC, a ASC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.search_account_liked_artists(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_account_liked_artists(UUID, TEXT, INTEGER)
  TO service_role;
