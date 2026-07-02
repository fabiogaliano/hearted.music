-- Read model for a playlist-orientation card's suggestion list.
--
-- presentMatchReviewItem previously rebuilt the card app-side: captured pair
-- ids were pulled out of the DB and sent back as `.in()` URL filters against
-- song and match_decision — the 414 URI-too-long class (legacy pre-cap
-- captures reach 845 pairs, ~33KB of query string), and ~10 HTTP round trips
-- per card. This function is the joined, dismissed-filtered, display-ordered
-- read of the captured authority: one POST round trip, and no id set ever
-- leaves Postgres.
--
-- Ordering matches the derivation's display order (C12: fit_score DESC, then
-- model_rank ASC, then stable id) rather than visible_rank, so cards captured
-- before the fitScore-first ordering shipped still render strongest-match
-- first. visible_rank stays untouched as the capture-time position record for
-- learning-to-rank.
--
-- total_active_count is a window count of the post-dismissal set so one call
-- returns both the page and the total; an all-dismissed or empty capture
-- returns zero rows, which the caller disambiguates with a captured-pair count.

CREATE OR REPLACE FUNCTION public.read_match_review_item_song_suggestions(
  p_item_id    UUID,
  p_account_id UUID,
  p_limit      INTEGER DEFAULT NULL,
  p_offset     INTEGER DEFAULT 0
) RETURNS TABLE (
  song_id            UUID,
  name               TEXT,
  artists            TEXT[],
  album_name         TEXT,
  image_url          TEXT,
  spotify_id         TEXT,
  genres             TEXT[],
  fit_score          DOUBLE PRECISION,
  visible_rank       INTEGER,
  model_rank         INTEGER,
  total_active_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    s.artists,
    s.album_name,
    s.image_url,
    s.spotify_id,
    s.genres,
    vp.fit_score,
    vp.visible_rank,
    vp.model_rank,
    count(*) OVER () AS total_active_count
  FROM public.match_review_item_visible_pair vp
  JOIN public.song s ON s.id = vp.song_id
  WHERE vp.queue_item_id = p_item_id
    AND vp.account_id = p_account_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.match_decision d
      WHERE d.account_id  = p_account_id
        AND d.song_id     = vp.song_id
        AND d.playlist_id = vp.playlist_id
        AND d.decision    = 'dismissed'
    )
  ORDER BY vp.fit_score DESC, vp.model_rank ASC, vp.song_id ASC
  LIMIT p_limit OFFSET p_offset
$$;

REVOKE EXECUTE ON FUNCTION public.read_match_review_item_song_suggestions(UUID, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.read_match_review_item_song_suggestions(UUID, UUID, INTEGER, INTEGER)
  TO service_role;

NOTIFY pgrst, 'reload schema';
