-- Everything the match visibility policy needs about one account's snapshot
-- pairs, in one set-returning read.
--
-- Queue derivation (eligible subjects) and card presentation (visible
-- suggestion list) each assembled these inputs themselves: the snapshot pairs,
-- then decisions, entitlement, ownership, song filter metadata and playlist
-- filters, feeding the DB-derived song/playlist id sets back through chunked
-- PostgREST .in() filters. Joining here keeps every id set inside Postgres and
-- gives both paths the same inputs.
--
-- One row per snapshot pair, scoped to the whole snapshot, one song, or one
-- playlist. The row carries flags and raw values only; the policy (strictness,
-- decisions, playlist filters) is evaluated in TypeScript, so match_filters
-- stays jsonb.
--
-- Pairs whose song is already in the playlist are excluded (the same
-- playlist_song anti-join get_match_pairs_for_song/_for_playlist apply), and the
-- snapshot must belong to p_account_id.
--
-- song_entitled comes from select_entitled_data_enriched_liked_song_ids, so a
-- change to who is entitled stays in one function.
--
-- Additive only: no existing function changes. Backend-private: callable only
-- through the service-role client. Callers page with .order(song_id,
-- playlist_id).range(); (snapshot_id, song_id, playlist_id) is unique, so pages
-- are disjoint.

CREATE OR REPLACE FUNCTION public.select_match_visibility_inputs(
  p_account_id  UUID,
  p_snapshot_id UUID,
  p_song_id     UUID DEFAULT NULL,
  p_playlist_id UUID DEFAULT NULL
) RETURNS TABLE (
  song_id             UUID,
  playlist_id         UUID,
  score               DOUBLE PRECISION,
  fused_score         DOUBLE PRECISION,
  song_entitled       BOOLEAN,
  playlist_owned      BOOLEAN,
  decided             BOOLEAN,
  language            TEXT,
  language_secondary  TEXT,
  release_year        INTEGER,
  vocal_gender        TEXT,
  liked_at            TIMESTAMPTZ,
  match_filters       JSONB,
  playlist_name       TEXT,
  playlist_spotify_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pairs AS (
    SELECT mr.song_id, mr.playlist_id, mr.score, mr.fused_score
    FROM public.match_result mr
    JOIN public.match_snapshot ms ON ms.id = mr.snapshot_id
    WHERE mr.snapshot_id = p_snapshot_id
      AND ms.account_id = p_account_id
      AND (p_song_id IS NULL OR mr.song_id = p_song_id)
      AND (p_playlist_id IS NULL OR mr.playlist_id = p_playlist_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.playlist_song ps
        WHERE ps.playlist_id = mr.playlist_id
          AND ps.song_id = mr.song_id
      )
  ),
  -- Passing the pair songs keeps the entitlement check to the snapshot's songs
  -- instead of the whole library.
  entitled AS (
    SELECT e.song_id
    FROM public.select_entitled_data_enriched_liked_song_ids(
      p_account_id,
      ARRAY(SELECT DISTINCT pairs.song_id FROM pairs)
    ) e
  )
  SELECT
    p.song_id,
    p.playlist_id,
    p.score,
    p.fused_score,
    e.song_id IS NOT NULL,
    pl.account_id = p_account_id,
    EXISTS (
      SELECT 1
      FROM public.match_decision md
      WHERE md.account_id = p_account_id
        AND md.song_id = p.song_id
        AND md.playlist_id = p.playlist_id
    ),
    s.language,
    s.language_secondary,
    s.release_year::INTEGER,
    s.vocal_gender,
    ls.liked_at,
    pl.match_filters,
    pl.name,
    pl.spotify_id
  FROM pairs p
  JOIN public.song s ON s.id = p.song_id
  JOIN public.playlist pl ON pl.id = p.playlist_id
  LEFT JOIN entitled e ON e.song_id = p.song_id
  LEFT JOIN public.liked_song ls
    ON ls.account_id = p_account_id
   AND ls.song_id = p.song_id
   AND ls.unliked_at IS NULL
$$;

REVOKE EXECUTE ON FUNCTION public.select_match_visibility_inputs(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.select_match_visibility_inputs(UUID, UUID, UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
