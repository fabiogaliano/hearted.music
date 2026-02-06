-- RPC function for liked songs statistics
-- Returns counts for total, analyzed, matched, and pending songs
-- Used by the liked songs page header to show accurate stats independent of pagination
-- Derives matched/pending counts from item_status table (single source of truth)

CREATE OR REPLACE FUNCTION get_liked_songs_stats(p_account_id UUID)
RETURNS TABLE (
  total BIGINT,
  analyzed BIGINT,
  matched BIGINT,
  pending BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id
    )),
    COUNT(*) FILTER (WHERE ist.action_type = 'added_to_playlist'),
    COUNT(*) FILTER (WHERE ist.id IS NULL)
  FROM liked_song ls
  LEFT JOIN item_status ist
    ON ist.item_id = ls.song_id
    AND ist.account_id = ls.account_id
    AND ist.item_type = 'song'
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL;
END;
$$ LANGUAGE plpgsql STABLE;
