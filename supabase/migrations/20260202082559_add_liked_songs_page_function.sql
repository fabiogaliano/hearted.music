-- RPC function for paginated liked songs with analysis
-- Returns liked_song + song + song_analysis data in a single query
-- Uses cursor-based pagination (liked_at timestamp) for consistent ordering

CREATE OR REPLACE FUNCTION get_liked_songs_page(
  p_account_id UUID,
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_filter TEXT DEFAULT 'all'
)
RETURNS TABLE (
  id UUID,
  liked_at TIMESTAMPTZ,
  status TEXT,
  song_id UUID,
  song_spotify_id TEXT,
  song_name TEXT,
  song_artists TEXT[],
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
    ls.status,
    s.id AS song_id,
    s.spotify_id AS song_spotify_id,
    s.name AS song_name,
    s.artists AS song_artists,
    s.album_name AS song_album_name,
    s.image_url AS song_image_url,
    sa.id AS analysis_id,
    sa.analysis AS analysis_content,
    sa.model AS analysis_model,
    sa.created_at AS analysis_created_at
  FROM liked_song ls
  JOIN song s ON s.id = ls.song_id
  LEFT JOIN song_analysis sa ON sa.song_id = s.id
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    AND (p_cursor IS NULL OR ls.liked_at < p_cursor)
    AND (
      p_filter = 'all'
      OR (p_filter = 'unsorted' AND ls.status IS NULL)
      OR (p_filter = 'sorted' AND ls.status = 'sorted')
      OR (p_filter = 'ignored' AND ls.status = 'ignored')
      OR (p_filter = 'analyzed' AND sa.id IS NOT NULL)
    )
  ORDER BY ls.liked_at DESC
  LIMIT p_limit + 1;
END;
$$ LANGUAGE plpgsql STABLE;
