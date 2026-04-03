-- Rename match_context → match_snapshot and align all related identifiers.
-- Also renames: context_hash → snapshot_hash, match_result.context_id → snapshot_id.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Rename table
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE match_context RENAME TO match_snapshot;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Rename columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE match_snapshot RENAME COLUMN context_hash TO snapshot_hash;
ALTER TABLE match_result RENAME COLUMN context_id TO snapshot_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Rename indexes on match_snapshot
-- ─────────────────────────────────────────────────────────────────────────────

ALTER INDEX idx_match_context_account_id RENAME TO idx_match_snapshot_account_id;
ALTER INDEX idx_match_context_latest RENAME TO idx_match_snapshot_latest;
ALTER INDEX idx_match_context_hash RENAME TO idx_match_snapshot_hash;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Rename indexes on match_result (context_id → snapshot_id)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER INDEX idx_match_result_context_id RENAME TO idx_match_result_snapshot_id;
ALTER INDEX idx_match_result_score RENAME TO idx_match_result_snapshot_score;
ALTER INDEX idx_match_result_rank RENAME TO idx_match_result_snapshot_rank;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Rename unique constraint on match_result
--    (context_id, song_id, playlist_id) → (snapshot_id, song_id, playlist_id)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE match_result RENAME CONSTRAINT match_result_context_id_song_id_playlist_id_key
  TO match_result_snapshot_id_song_id_playlist_id_key;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Rename foreign key constraints
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE match_snapshot RENAME CONSTRAINT match_context_account_id_fkey
  TO match_snapshot_account_id_fkey;

ALTER TABLE match_result RENAME CONSTRAINT match_result_context_id_fkey
  TO match_result_snapshot_id_fkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Rename RLS policy
-- ─────────────────────────────────────────────────────────────────────────────

ALTER POLICY match_context_deny_all ON match_snapshot RENAME TO match_snapshot_deny_all;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Rename unique constraint on match_snapshot.snapshot_hash
--    (was context_hash unique)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE match_snapshot RENAME CONSTRAINT match_context_context_hash_key
  TO match_snapshot_snapshot_hash_key;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Rename PK constraint
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE match_snapshot RENAME CONSTRAINT match_context_pkey
  TO match_snapshot_pkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Update publish_match_snapshot function
--     Must DROP first because parameter name changes (p_context_hash → p_snapshot_hash)
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS publish_match_snapshot(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB);

CREATE OR REPLACE FUNCTION publish_match_snapshot(
  p_account_id UUID,
  p_algorithm_version TEXT,
  p_config_hash TEXT,
  p_playlist_set_hash TEXT,
  p_candidate_set_hash TEXT,
  p_snapshot_hash TEXT,
  p_playlist_count INTEGER,
  p_song_count INTEGER,
  p_results JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  v_snapshot_id UUID;
  v_latest_hash TEXT;
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

  -- Insert new snapshot
  INSERT INTO match_snapshot (
    account_id, algorithm_version, config_hash,
    playlist_set_hash, candidate_set_hash, snapshot_hash,
    playlist_count, song_count
  ) VALUES (
    p_account_id, p_algorithm_version, p_config_hash,
    p_playlist_set_hash, p_candidate_set_hash, p_snapshot_hash,
    p_playlist_count, p_song_count
  ) RETURNING id INTO v_snapshot_id;

  -- Insert results if any
  IF jsonb_array_length(p_results) > 0 THEN
    INSERT INTO match_result (snapshot_id, song_id, playlist_id, score, rank, factors)
    SELECT
      v_snapshot_id,
      (r->>'song_id')::UUID,
      (r->>'playlist_id')::UUID,
      (r->>'score')::DOUBLE PRECISION,
      (r->>'rank')::INTEGER,
      COALESCE(r->'factors', '{}'::JSONB)
    FROM jsonb_array_elements(p_results) AS r;
  END IF;

  RETURN v_snapshot_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Update get_liked_songs_page function
-- ─────────────────────────────────────────────────────────────────────────────

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
  analysis_created_at TIMESTAMPTZ,
  audio_tempo REAL,
  audio_energy REAL,
  audio_valence REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_latest_snapshot_id UUID;
BEGIN
  SELECT ms.id INTO v_latest_snapshot_id
  FROM match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
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
    sa.created_at AS analysis_created_at,
    saf.tempo AS audio_tempo,
    saf.energy AS audio_energy,
    saf.valence AS audio_valence
  FROM liked_song ls
  JOIN song s ON s.id = ls.song_id
  LEFT JOIN artist a ON a.spotify_id = s.artist_ids[1]
  LEFT JOIN song_audio_feature saf ON saf.song_id = s.id
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
    WHERE mr.snapshot_id = v_latest_snapshot_id
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Update get_liked_songs_stats function
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_liked_songs_stats(UUID);

CREATE OR REPLACE FUNCTION get_liked_songs_stats(p_account_id UUID)
RETURNS TABLE (
  total BIGINT,
  analyzed BIGINT,
  matched BIGINT,
  has_suggestions BIGINT,
  new_suggestions BIGINT,
  pending BIGINT
) AS $$
DECLARE
  v_latest_snapshot_id UUID;
BEGIN
  SELECT ms.id INTO v_latest_snapshot_id
  FROM match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id
    )),
    -- matched: has match_result rows, all covered by match_decision
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
    ) AND NOT EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    )),
    -- has_suggestions: at least one undecided match_result
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    )),
    -- new_suggestions: undecided match_result AND is_new = true
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    ) AND EXISTS (
      SELECT 1 FROM item_status ist
      WHERE ist.item_id = ls.song_id
        AND ist.account_id = ls.account_id
        AND ist.item_type = 'song'
        AND ist.is_new = true
    )),
    -- pending: no item_status row
    COUNT(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM item_status ist
      WHERE ist.item_id = ls.song_id
        AND ist.account_id = ls.account_id
        AND ist.item_type = 'song'
    ))
  FROM liked_song ls
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL;
END;
$$ LANGUAGE plpgsql STABLE;
