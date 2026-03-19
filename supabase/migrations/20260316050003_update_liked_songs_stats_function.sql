-- Update get_liked_songs_stats to derive counts from match_result/match_decision
-- instead of item_status.action_type (which no longer exists)
--
-- matched = songs with match_result rows where all are covered by match_decision
-- has_suggestions = songs with at least one undecided match_result
-- pending = songs with no item_status row (not yet pipeline processed)

-- Return type changed (added has_suggestions) — must drop before recreate
DROP FUNCTION IF EXISTS get_liked_songs_stats(UUID);

CREATE OR REPLACE FUNCTION get_liked_songs_stats(p_account_id UUID)
RETURNS TABLE (
  total BIGINT,
  analyzed BIGINT,
  matched BIGINT,
  has_suggestions BIGINT,
  pending BIGINT
) AS $$
DECLARE
  v_latest_context_id UUID;
BEGIN
  SELECT mc.id INTO v_latest_context_id
  FROM match_context mc
  WHERE mc.account_id = p_account_id
  ORDER BY mc.created_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id
    )),
    -- matched: has match_result rows, all covered by match_decision
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.context_id = v_latest_context_id AND mr.song_id = ls.song_id
    ) AND NOT EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.context_id = v_latest_context_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    )),
    -- has_suggestions: has match_result rows with at least one undecided
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.context_id = v_latest_context_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    )),
    -- pending: no item_status row
    COUNT(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM item_status ist
      WHERE ist.item_id = ls.song_id
        AND ist.account_id = ls.account_id
        AND ist.item_type = 'song'
    ))
  FROM liked_song ls
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL;
END;
$$ LANGUAGE plpgsql STABLE;
