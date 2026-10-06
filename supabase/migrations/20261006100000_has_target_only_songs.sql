-- Whether any song in the account's target playlists is outside its active
-- liked library (a "target-only" song that needs lightweight enrichment).
--
-- Replaces an app-side probe that read every target playlist's songs and sent
-- all their ids back through one unchunked .in() filter. Past ~200 ids the
-- request URL overflowed, the error was read as "no target enrichment needed",
-- and large target playlists silently skipped the enrichment stage.
--
-- Expand-only: adds a function, changes nothing existing.

CREATE OR REPLACE FUNCTION has_target_only_songs(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM playlist p
    JOIN playlist_song ps ON ps.playlist_id = p.id
    WHERE p.account_id = p_account_id
      AND p.is_target
      AND NOT EXISTS (
        SELECT 1
        FROM liked_song ls
        WHERE ls.account_id = p_account_id
          AND ls.song_id = ps.song_id
          AND ls.unliked_at IS NULL
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION has_target_only_songs(UUID) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION has_target_only_songs(UUID) TO service_role;
