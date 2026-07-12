-- Song-id source for the seed-template "Around [artist]" pin (playlist creation
-- beat 1).
--
-- Returns the ids of an account's still-liked songs credited to one artist, most
-- recently liked first. The studio pins these so the preview opens on the
-- artist's own songs rather than the generic library top. The artist name is
-- user-chosen from their own taste profile (get_account_top_artists); the array
-- membership predicate (name = ANY(song.artists)) lives here in SQL, so no
-- DB-derived id set ever re-enters a query as a URL .in() filter.
--
-- Backend-private: callable only through the service-role client (same posture
-- as the other seed-stage RPCs).

CREATE OR REPLACE FUNCTION get_account_liked_song_ids_by_artist(
  p_account_id UUID,
  p_artist     TEXT
)
RETURNS TABLE (song_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ls.song_id
  FROM liked_song ls
  JOIN song s ON s.id = ls.song_id
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    AND p_artist = ANY(s.artists)
  ORDER BY ls.liked_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_account_liked_song_ids_by_artist(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_account_liked_song_ids_by_artist(UUID, TEXT)
  TO service_role;
