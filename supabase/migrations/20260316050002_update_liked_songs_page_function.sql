-- Update get_liked_songs_page to derive matching status from match_result/match_decision
-- instead of item_status.action_type (which no longer exists)
--
-- Matching status derivation:
--   'has_suggestions' = match_result rows exist in latest context, not all covered by match_decision
--   'acted'           = match_result rows exist but all covered by match_decision
--   'no_suggestions'  = no match_result rows, but item_status exists (pipeline processed)
--   'pending'         = no item_status row (not yet pipeline processed)

CREATE OR REPLACE FUNCTION get_liked_songs_page(
  p_account_id UUID,
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_filter TEXT DEFAULT 'all'
)
RETURNS TABLE (
  id UUID,
  liked_at TIMESTAMPTZ,
  matching_status TEXT,
  song_id UUID,
  song_spotify_id TEXT,
  song_name TEXT,
  song_artists TEXT[],
  song_artist_ids TEXT[],
  song_album_name TEXT,
  song_image_url TEXT,
  analysis_id UUID,
  analysis_content JSONB,
  analysis_model TEXT,
  analysis_created_at TIMESTAMPTZ
) AS $$
DECLARE
  v_latest_context_id UUID;
BEGIN
  -- Find the latest match_context for this account
  SELECT mc.id INTO v_latest_context_id
  FROM match_context mc
  WHERE mc.account_id = p_account_id
  ORDER BY mc.created_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    ls.id,
    ls.liked_at,
    CASE
      -- Has match_result rows with at least one not covered by match_decision
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count > 0 THEN 'has_suggestions'
      -- Has match_result rows but ALL covered by match_decision
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count = 0 THEN 'acted'
      -- Pipeline processed but no suggestions
      WHEN ist.id IS NOT NULL THEN 'no_suggestions'
      -- Not yet processed
      ELSE 'pending'
    END AS matching_status,
    s.id AS song_id,
    s.spotify_id AS song_spotify_id,
    s.name AS song_name,
    s.artists AS song_artists,
    s.artist_ids AS song_artist_ids,
    s.album_name AS song_album_name,
    s.image_url AS song_image_url,
    sa.id AS analysis_id,
    sa.analysis AS analysis_content,
    sa.model AS analysis_model,
    sa.created_at AS analysis_created_at
  FROM liked_song ls
  JOIN song s ON s.id = ls.song_id
  LEFT JOIN LATERAL (
    SELECT sa2.id, sa2.analysis, sa2.model, sa2.created_at
    FROM song_analysis sa2
    WHERE sa2.song_id = s.id
    ORDER BY sa2.created_at DESC
    LIMIT 1
  ) sa ON true
  LEFT JOIN item_status ist
    ON ist.item_id = ls.song_id
    AND ist.account_id = ls.account_id
    AND ist.item_type = 'song'
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS total_results,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
      )::int AS undecided_count
    FROM match_result mr
    WHERE mr.context_id = v_latest_context_id
      AND mr.song_id = ls.song_id
  ) mr_agg ON true
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    AND (p_cursor IS NULL OR ls.liked_at < p_cursor)
    AND (
      p_filter = 'all'
      OR (p_filter = 'pending' AND ist.id IS NULL)
      OR (p_filter = 'has_suggestions' AND mr_agg.total_results > 0 AND mr_agg.undecided_count > 0)
      OR (p_filter = 'acted' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
      OR (p_filter = 'no_suggestions' AND ist.id IS NOT NULL AND COALESCE(mr_agg.total_results, 0) = 0)
      OR (p_filter = 'analyzed' AND sa.id IS NOT NULL)
      -- Keep backwards compat filter names
      OR (p_filter = 'matched' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
      OR (p_filter = 'ignored' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
    )
  ORDER BY ls.liked_at DESC
  LIMIT p_limit + 1;
END;
$$ LANGUAGE plpgsql STABLE;
