-- RPC function for liked songs statistics
-- Returns counts for total, analyzed, sorted, and unsorted songs
-- Used by the liked songs page header to show accurate stats independent of pagination

CREATE OR REPLACE FUNCTION get_liked_songs_stats(p_account_id UUID)
RETURNS TABLE (
  total BIGINT,
  analyzed BIGINT,
  sorted BIGINT,
  unsorted BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id
    )),
    COUNT(*) FILTER (WHERE ls.status = 'sorted'),
    COUNT(*) FILTER (WHERE ls.status IS NULL OR ls.status = 'unsorted')
  FROM liked_song ls
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL;
END;
$$ LANGUAGE plpgsql STABLE;
