-- RPC function for paginated liked songs with analysis and matching status
-- Returns liked_song + song + latest song_analysis + item_status data
-- Uses cursor-based pagination (liked_at timestamp) for consistent ordering
-- Uses LEFT JOIN LATERAL to get only the latest analysis per song (prevents duplicate rows)
-- Derives matching_status from item_status table (single source of truth)

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
BEGIN
  RETURN QUERY
  SELECT
    ls.id,
    ls.liked_at,
    CASE
      WHEN ist.action_type = 'added_to_playlist' THEN 'matched'
      WHEN ist.action_type IN ('skipped', 'dismissed') THEN 'ignored'
      ELSE NULL
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
    SELECT sa.id, sa.analysis, sa.model, sa.created_at
    FROM song_analysis sa
    WHERE sa.song_id = s.id
    ORDER BY sa.created_at DESC
    LIMIT 1
  ) sa ON true
  LEFT JOIN item_status ist
    ON ist.item_id = ls.song_id
    AND ist.account_id = ls.account_id
    AND ist.item_type = 'song'
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    AND (p_cursor IS NULL OR ls.liked_at < p_cursor)
    AND (
      p_filter = 'all'
      OR (p_filter = 'pending' AND ist.id IS NULL)
      OR (p_filter = 'matched' AND ist.action_type = 'added_to_playlist')
      OR (p_filter = 'ignored' AND ist.action_type IN ('skipped', 'dismissed'))
      OR (p_filter = 'analyzed' AND sa.id IS NOT NULL)
    )
  ORDER BY ls.liked_at DESC
  LIMIT p_limit + 1;
END;
$$ LANGUAGE plpgsql STABLE;
