-- Artist table: normalized storage for artist metadata
-- Songs reference artists via artist_ids text[] (Spotify IDs)

CREATE TABLE artist (
  spotify_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_artist_name ON artist (name);

-- Update get_liked_songs_page to include artist image from artist table
-- Requires DROP because return type is changing (adding artist_image_url)

DROP FUNCTION IF EXISTS get_liked_songs_page(UUID, TIMESTAMPTZ, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION get_liked_songs_page(
  p_account_id UUID,
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
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
  song_genres TEXT[],
  artist_image_url TEXT,
  analysis_id UUID,
  analysis_content JSONB,
  analysis_model TEXT,
  analysis_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
    ls.id,
    ls.liked_at,
    CASE
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count > 0 THEN 'has_suggestions'
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count = 0 THEN 'acted'
      WHEN ist.id IS NOT NULL THEN 'no_suggestions'
      ELSE 'pending'
    END AS matching_status,
    s.id AS song_id,
    s.spotify_id AS song_spotify_id,
    s.name AS song_name,
    s.artists AS song_artists,
    s.artist_ids AS song_artist_ids,
    s.album_name AS song_album_name,
    s.image_url AS song_image_url,
    s.genres AS song_genres,
    a.image_url AS artist_image_url,
    sa.id AS analysis_id,
    sa.analysis AS analysis_content,
    sa.model AS analysis_model,
    sa.created_at AS analysis_created_at
  FROM liked_song ls
  JOIN song s ON s.id = ls.song_id
  LEFT JOIN artist a ON a.spotify_id = s.artist_ids[1]
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
      OR (p_filter = 'matched' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
      OR (p_filter = 'ignored' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
    )
  ORDER BY ls.liked_at DESC
  LIMIT p_limit + 1;
END;
$$;
