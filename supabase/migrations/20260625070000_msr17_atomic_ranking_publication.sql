-- MSR-17: Complete publish_match_snapshot ranking insertion.
--
-- Replaces the compatibility shell from MSR-05 (20260625000000).
-- Each item in p_results MAY carry a nested "rankings" array (D1).
-- When the array is present its rows are inserted into match_result_ranking
-- atomically inside the same transaction. When it is absent COALESCE defaults
-- the inner expand to an empty array, so legacy callers that omit "rankings"
-- continue to publish unchanged (D1 backward compat).
--
-- Nested ranking row fields (D2):
--   orientation    TEXT             'song' | 'playlist'
--   rank           INTEGER          1-based dense rank within that oriented slate
--   ordering_score DOUBLE PRECISION authoritative sort key
--   reranker_score DOUBLE PRECISION raw cross-encoder score; JSON null → SQL NULL
--   source         TEXT             'rerank' | 'fused_fallback'
--   document_mode  TEXT             'analysis' | 'metadata'
--
-- Legacy score/rank mirror (C12): the orchestrator sets match_result.score and
-- match_result.rank from song-orientation ranking data before calling the RPC,
-- so those columns continue to carry per-pair data for old read paths.
--
-- SET search_path is pinned inline because CREATE OR REPLACE discards settings
-- previously attached via ALTER FUNCTION (see 20260330000001 / 20260519110000).

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

    -- Atomically insert ranking rows from the nested "rankings" array on each
    -- result item (D1/D2). COALESCE(r->'rankings', '[]') expands to zero rows
    -- for any result item that omits the rankings key, so old callers are fully
    -- backward compatible and the insert is a no-op for those items.
    --
    -- reranker_score: JSON null values become SQL NULL via the ->>' ' operator
    -- (PostgreSQL returns SQL NULL for JSON null via the text extraction path).
    INSERT INTO match_result_ranking (
      snapshot_id, song_id, playlist_id,
      orientation, rank, ordering_score, reranker_score, source, document_mode
    )
    SELECT
      v_snapshot_id,
      (r->>'song_id')::UUID,
      (r->>'playlist_id')::UUID,
      rk->>'orientation',
      (rk->>'rank')::INTEGER,
      (rk->>'ordering_score')::DOUBLE PRECISION,
      (rk->>'reranker_score')::DOUBLE PRECISION,
      rk->>'source',
      rk->>'document_mode'
    FROM jsonb_array_elements(p_results) AS r
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(r->'rankings', '[]'::JSONB)
    ) AS rk;
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

REVOKE ALL ON FUNCTION publish_match_snapshot(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_match_snapshot(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB)
  TO service_role;
