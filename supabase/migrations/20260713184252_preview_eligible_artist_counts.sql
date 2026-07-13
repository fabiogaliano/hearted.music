-- Artist counts across the playlist-creation flow become promises, not stats.
--
-- Both artist-count RPCs previously aggregated over ALL still-liked songs,
-- while the studio resolves an anchor artist's pins from the preview-eligible
-- population only: the 10,000 most-recent likes (PHASE1_CANDIDATE_CAP in
-- src/lib/domains/playlists/candidate-loader.ts) that carry Phase-1 enrichment
-- (non-empty genres OR a song_audio_feature row) — the engine cannot place a
-- song outside that set; such a pin would land in droppedPinnedSongIds. The
-- mismatch made counts shrink visibly: pick "Radiohead · 34" in search, get a
-- chip resolving to 28. Every count these RPCs return is read as "what will
-- anchoring this artist give me", so they must count exactly the population
-- the resolver draws from.
--
-- Both bodies inline the same recent_likes CTE + enrichment predicate; keep
-- the three definitions (these two and the candidate loader) in lockstep.
--
-- Backend-private posture unchanged: service-role only. Signatures and result
-- shapes are unchanged, so no regenerated types are needed.

CREATE OR REPLACE FUNCTION get_account_top_artists(
  p_account_id UUID,
  p_limit      INTEGER DEFAULT 12
)
RETURNS TABLE (artist TEXT, occurrences BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent_likes AS (
    SELECT ls.song_id
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
    ORDER BY ls.liked_at DESC
    LIMIT 10000
  )
  SELECT a AS artist, COUNT(*)::BIGINT AS occurrences
  FROM recent_likes rl
  JOIN song s ON s.id = rl.song_id
  CROSS JOIN LATERAL unnest(s.artists) AS a
  WHERE (
    cardinality(s.genres) > 0
    OR EXISTS (SELECT 1 FROM song_audio_feature f WHERE f.song_id = s.id)
  )
  GROUP BY a
  ORDER BY occurrences DESC, a ASC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION search_account_liked_artists(
  p_account_id UUID,
  p_query      TEXT    DEFAULT '',
  p_limit      INTEGER DEFAULT 50
)
RETURNS TABLE (artist TEXT, occurrences BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent_likes AS (
    SELECT ls.song_id
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
    ORDER BY ls.liked_at DESC
    LIMIT 10000
  )
  SELECT a AS artist, COUNT(*)::BIGINT AS occurrences
  FROM recent_likes rl
  JOIN song s ON s.id = rl.song_id
  CROSS JOIN LATERAL unnest(s.artists) AS a
  WHERE (
    cardinality(s.genres) > 0
    OR EXISTS (SELECT 1 FROM song_audio_feature f WHERE f.song_id = s.id)
  )
    AND (p_query = '' OR a ILIKE '%' || p_query || '%')
  GROUP BY a
  ORDER BY occurrences DESC, a ASC
  LIMIT p_limit;
$$;
