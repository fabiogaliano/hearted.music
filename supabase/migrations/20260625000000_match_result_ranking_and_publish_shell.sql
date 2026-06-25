-- MSR-05: Ranking schema and publish_match_snapshot compatibility shell.
--
-- Part 1: match_result_ranking table (C1, C2).
--
-- Orientation-specific ranking rows are the authoritative ordering source for
-- the match-system-refactor read paths. The legacy match_result.rank / .score
-- fields remain populated for backward compatibility (C12); ranking rows
-- supersede them wherever the new read paths are active.
--
-- Each row records WHERE a (song, playlist) pair ranked inside a specific
-- oriented suggestion list (B5). A song-oriented row says "this playlist ranked
-- N among all playlist suggestions for this song"; a playlist-oriented row says
-- "this song ranked N among all song suggestions for this playlist."
--
-- The compound FK to match_result ensures a ranking row can only exist for a
-- pair that was actually published inside that snapshot.

CREATE TABLE public.match_result_ranking (
  id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   UUID             NOT NULL,
  song_id       UUID             NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  playlist_id   UUID             NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,

  orientation   TEXT             NOT NULL CHECK (orientation IN ('song', 'playlist')),
  rank          INTEGER          NOT NULL CHECK (rank >= 1),
  ordering_score DOUBLE PRECISION NOT NULL,
  -- null when source = 'fused_fallback' (no cross-encoder was invoked)
  reranker_score DOUBLE PRECISION,
  source        TEXT             NOT NULL CHECK (source IN ('rerank', 'fused_fallback')),
  document_mode TEXT             NOT NULL CHECK (document_mode IN ('analysis', 'metadata')),

  created_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),

  -- Anchors the ranking to the exact (snapshot, song, playlist) result row.
  FOREIGN KEY (snapshot_id, song_id, playlist_id)
    REFERENCES match_result(snapshot_id, song_id, playlist_id)
    ON DELETE CASCADE
);

-- Partial unique indexes enforce one dense rank per oriented suggestion list.
--
-- Song orientation: each song has exactly one result ranked N across all its
-- playlist suggestions within a snapshot.
CREATE UNIQUE INDEX idx_match_result_ranking_song_slate_rank_unique
  ON public.match_result_ranking (snapshot_id, song_id, rank)
  WHERE orientation = 'song';

-- Playlist orientation: each playlist has exactly one result ranked N across
-- all its song suggestions within a snapshot.
CREATE UNIQUE INDEX idx_match_result_ranking_playlist_slate_rank_unique
  ON public.match_result_ranking (snapshot_id, playlist_id, rank)
  WHERE orientation = 'playlist';

-- FK cascade target: the compound FK above already covers snapshot+song+playlist,
-- but a delete on match_snapshot cascades via match_result first, so index
-- snapshot_id alone for the cascade scan performance.
CREATE INDEX match_result_ranking_snapshot_id_idx
  ON public.match_result_ranking (snapshot_id);

-- Explicit FK index for song/playlist delete cascade scans (the compound FK
-- above is not usable for single-column cascade lookups).
CREATE INDEX match_result_ranking_song_id_idx
  ON public.match_result_ranking (song_id);

CREATE INDEX match_result_ranking_playlist_id_idx
  ON public.match_result_ranking (playlist_id);

ALTER TABLE public.match_result_ranking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "match_result_ranking_deny_all"
  ON public.match_result_ranking FOR ALL USING (false);

-- ============================================================================
-- Part 2: publish_match_snapshot compatibility shell (D1).
--
-- The function signature is unchanged; this CREATE OR REPLACE only documents
-- the intentional-ignore contract so it is explicit rather than incidental:
--
--   Each item in p_results MAY carry a nested "rankings" array. Those rows are
--   silently ignored here. Full ranking insertion (reading and inserting into
--   match_result_ranking) lands in MSR-17. This makes every caller that already
--   populates "rankings" pass through without error, and callers that omit
--   "rankings" continue working unchanged.
--
-- SET search_path is pinned inline; CREATE OR REPLACE discards config settings
-- attached via ALTER FUNCTION, so omitting it would silently undo the
-- SECURITY DEFINER hardening from 20260330000001 / 20260519110000.
-- ============================================================================

CREATE OR REPLACE FUNCTION publish_match_snapshot(
  p_account_id         UUID,
  p_algorithm_version  TEXT,
  p_config_hash        TEXT,
  p_playlist_set_hash  TEXT,
  p_candidate_set_hash TEXT,
  p_snapshot_hash      TEXT,
  p_playlist_count     INTEGER,
  p_song_count         INTEGER,
  p_results            JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id  UUID;
  v_latest_hash  TEXT;
BEGIN
  -- No-op only if the LATEST published snapshot already has this hash.
  SELECT snapshot_hash INTO v_latest_hash
  FROM match_snapshot
  WHERE account_id = p_account_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest_hash = p_snapshot_hash THEN
    RETURN NULL;
  END IF;

  INSERT INTO match_snapshot (
    account_id, algorithm_version, config_hash,
    playlist_set_hash, candidate_set_hash, snapshot_hash,
    playlist_count, song_count
  ) VALUES (
    p_account_id, p_algorithm_version, p_config_hash,
    p_playlist_set_hash, p_candidate_set_hash, p_snapshot_hash,
    p_playlist_count, p_song_count
  ) RETURNING id INTO v_snapshot_id;

  IF jsonb_array_length(p_results) > 0 THEN
    INSERT INTO match_result (
      snapshot_id, song_id, playlist_id,
      score, fused_score, rank, factors, normalized_factors
    )
    SELECT
      v_snapshot_id,
      (r->>'song_id')::UUID,
      (r->>'playlist_id')::UUID,
      (r->>'score')::DOUBLE PRECISION,
      (r->>'fused_score')::DOUBLE PRECISION,
      (r->>'rank')::INTEGER,
      COALESCE(r->'factors', '{}'::JSONB),
      COALESCE(r->'normalized_factors', '{}'::JSONB)
    FROM jsonb_array_elements(p_results) AS r;
    -- NOTE: r->'rankings' is intentionally not read here (MSR-17 shell).
    -- Any caller that already embeds a nested "rankings" array per result item
    -- will pass through without error; the array is ignored until MSR-17 wires
    -- the full match_result_ranking insertion.
  END IF;

  -- Record the profile each result playlist was matched with. Resolved via the
  -- SAME "newest profile per playlist" rule the matcher uses (getPlaylistProfile
  -- orders by updated_at DESC), so this pins the exact profile row that produced
  -- these results. Only playlists that actually have results are captured; the
  -- LATERAL join silently drops any playlist with no profile row.
  --
  -- SINGLE-FLIGHT INVARIANT (why re-resolving here is safe rather than threading
  -- the exact profile_id from the matcher): the only path that writes profiles
  -- for matching is the match_snapshot_refresh workflow, and a unique partial
  -- index on job (type='match_snapshot_refresh', status IN pending/running) makes
  -- it single-flight per account. So between the matcher computing a profile and
  -- this publish, no concurrent refresh can upsert a newer playlist_profile row,
  -- and the newest row IS the one matching used. The only way this captures the
  -- wrong profile is if ANOTHER profile-writing path (a second workflow, a manual
  -- backfill, a future re-profiler) runs concurrently for the same account. If
  -- such a path is ever added, thread the exact profile_id used by matching
  -- through publish_match_snapshot instead of re-resolving by updated_at.
  INSERT INTO match_snapshot_playlist_profile (snapshot_id, playlist_id, profile_id)
  SELECT v_snapshot_id, pl.playlist_id, prof.id
  FROM (
    SELECT DISTINCT playlist_id
    FROM match_result
    WHERE snapshot_id = v_snapshot_id
  ) pl
  JOIN LATERAL (
    SELECT id
    FROM playlist_profile pp
    WHERE pp.playlist_id = pl.playlist_id
    ORDER BY pp.updated_at DESC
    LIMIT 1
  ) prof ON TRUE;

  RETURN v_snapshot_id;
END;
$$;
