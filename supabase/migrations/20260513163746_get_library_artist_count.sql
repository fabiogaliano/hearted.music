CREATE OR REPLACE FUNCTION get_library_artist_count(p_account_id uuid)
RETURNS bigint
LANGUAGE sql STABLE
AS $$
  SELECT count(DISTINCT aid)
  FROM (
    SELECT unnest(s.artist_ids) AS aid
    FROM song s
    INNER JOIN liked_song ls ON ls.song_id = s.id
    WHERE ls.account_id = p_account_id AND ls.unliked_at IS NULL
    UNION ALL
    SELECT unnest(s.artist_ids) AS aid
    FROM song s
    INNER JOIN playlist_song ps ON ps.song_id = s.id
    INNER JOIN playlist p ON p.id = ps.playlist_id
    WHERE p.account_id = p_account_id
  ) combined
$$;
