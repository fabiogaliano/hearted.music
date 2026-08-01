-- Resolve every selected studio artist in one round-trip while preserving the
-- preview candidate population and recency order. The recency cap intentionally
-- runs before artist matching: counts, resolved pins, and preview candidates must
-- all describe the same 10,000 active likes.
--
-- Backend-private: callable only through the service-role client.

CREATE OR REPLACE FUNCTION resolve_artist_liked_songs(
  p_account_id UUID,
  p_artists    TEXT[]
)
RETURNS TABLE (artist TEXT, song_ids UUID[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested_artists AS (
    SELECT requested.artist, requested.ordinality
    FROM unnest(p_artists) WITH ORDINALITY AS requested(artist, ordinality)
  ),
  recent_likes AS (
    SELECT ls.song_id, ls.liked_at
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
    ORDER BY ls.liked_at DESC, ls.song_id ASC
    LIMIT 10000
  ),
  eligible_likes AS (
    SELECT rl.song_id, rl.liked_at, s.artists
    FROM recent_likes rl
    JOIN song s ON s.id = rl.song_id
    WHERE (
      cardinality(s.genres) > 0
      OR EXISTS (SELECT 1 FROM song_audio_feature f WHERE f.song_id = s.id)
    )
  )
  SELECT
    requested.artist,
    COALESCE(
      array_agg(
        eligible.song_id
        ORDER BY eligible.liked_at DESC, eligible.song_id ASC
      ) FILTER (WHERE eligible.song_id IS NOT NULL),
      '{}'::UUID[]
    ) AS song_ids
  FROM requested_artists requested
  LEFT JOIN eligible_likes eligible
    ON requested.artist = ANY(eligible.artists)
  GROUP BY requested.ordinality, requested.artist
  ORDER BY requested.ordinality;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_artist_liked_songs(UUID, TEXT[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_artist_liked_songs(UUID, TEXT[])
  TO service_role;
