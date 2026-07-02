-- Keyset pagination for the playlist-card suggestion read model.
--
-- The offset-based read (20260702120000) breaks under row-dismissal: the
-- dismissed anti-join removes rows server-side, so an offset computed against
-- a stale page count can skip or repeat rows mid-review (a dismissed pair
-- shifts every row after it). A keyset cursor on the sort key
-- (fit_score DESC, model_rank ASC, song_id ASC) is immune — song_id is unique
-- per item, so the triple is a strict total order, and the WHERE clause
-- compares sort-key VALUES, not row existence, so a dismissed cursor row is
-- harmless.
--
-- DROP + recreate (not CREATE OR REPLACE) because the parameter list changes
-- shape (p_offset removed, three p_after_* cursor args added) — PostgREST
-- would otherwise see two overloads and refuse to resolve the RPC call.

DROP FUNCTION IF EXISTS public.read_match_review_item_song_suggestions(UUID, UUID, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.read_match_review_item_song_suggestions(
  p_item_id           UUID,
  p_account_id        UUID,
  p_limit             INTEGER DEFAULT NULL,
  p_after_fit_score    DOUBLE PRECISION DEFAULT NULL,
  p_after_model_rank   INTEGER DEFAULT NULL,
  p_after_song_id      UUID DEFAULT NULL
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
  -- total_active_count is a window count of the post-WHERE set, which includes
  -- the keyset predicate below. It equals the full active total ONLY on the
  -- cursorless first-page call (p_after_* all NULL) — on a cursor page it
  -- counts just the remaining post-cursor rows and must not be read as the
  -- item's total. Callers must read the total exclusively from the first,
  -- cursorless call.
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
    -- Keyset predicate written out explicitly: a row-value tuple comparison
    -- (fit_score, model_rank, song_id) > (...) can't mix DESC/ASC directions,
    -- so each sort key needs its own comparator against the cursor.
    AND (
      p_after_fit_score IS NULL
      OR vp.fit_score < p_after_fit_score
      OR (vp.fit_score = p_after_fit_score AND vp.model_rank > p_after_model_rank)
      OR (vp.fit_score = p_after_fit_score AND vp.model_rank = p_after_model_rank AND vp.song_id > p_after_song_id)
    )
  ORDER BY vp.fit_score DESC, vp.model_rank ASC, vp.song_id ASC
  LIMIT p_limit
$$;

REVOKE EXECUTE ON FUNCTION public.read_match_review_item_song_suggestions(UUID, UUID, INTEGER, DOUBLE PRECISION, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.read_match_review_item_song_suggestions(UUID, UUID, INTEGER, DOUBLE PRECISION, INTEGER, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
