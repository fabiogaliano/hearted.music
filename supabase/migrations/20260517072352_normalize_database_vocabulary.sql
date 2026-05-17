-- Normalize database vocabulary: rename tables, indexes, triggers, constraints,
-- and RPCs to match current domain language. Pre-prod clean break.
--
-- Tables:
--   api_token       -> extension_api_token
--   item_status     -> account_item_newness
--   job_failure     -> job_item_failure
--
-- RPCs:
--   resolve_stage_failures     -> resolve_job_item_stage_failures
--   count_unresolved_failures  -> count_unresolved_job_item_failures

BEGIN;

-- ============================================================================
-- 1. Rename tables
-- ============================================================================

ALTER TABLE api_token RENAME TO extension_api_token;
ALTER TABLE item_status RENAME TO account_item_newness;
ALTER TABLE job_failure RENAME TO job_item_failure;

-- ============================================================================
-- 2. Rename indexes
-- ============================================================================

-- extension_api_token (was api_token)
ALTER INDEX idx_api_token_account_id RENAME TO idx_extension_api_token_account_id;
ALTER INDEX idx_api_token_token_hash RENAME TO idx_extension_api_token_token_hash;

-- account_item_newness (was item_status)
ALTER INDEX idx_item_status_account_new RENAME TO idx_account_item_newness_account_new;
ALTER INDEX idx_item_status_item RENAME TO idx_account_item_newness_item;

-- job_item_failure (was job_failure)
ALTER INDEX idx_job_failure_job_id RENAME TO idx_job_item_failure_job_id;
ALTER INDEX idx_job_failure_job_type RENAME TO idx_job_item_failure_job_type;
ALTER INDEX idx_job_failure_terminal_lookup RENAME TO idx_job_item_failure_terminal_lookup;
ALTER INDEX idx_job_failure_stage_code RENAME TO idx_job_item_failure_stage_code;
ALTER INDEX idx_job_failure_active_suppression RENAME TO idx_job_item_failure_active_suppression;

-- ============================================================================
-- 3. Rename constraints (PK / FK / UNIQUE)
--    ALTER TABLE ... RENAME TO ... preserves data and dependent objects but
--    leaves auto-generated constraint names tied to the original table name.
--    Realign them so `\d <table>` and generated Supabase types reflect the
--    new vocabulary.
-- ============================================================================

-- extension_api_token (was api_token)
ALTER TABLE extension_api_token
  RENAME CONSTRAINT api_token_pkey TO extension_api_token_pkey;
ALTER TABLE extension_api_token
  RENAME CONSTRAINT api_token_account_id_fkey TO extension_api_token_account_id_fkey;

-- account_item_newness (was item_status)
ALTER TABLE account_item_newness
  RENAME CONSTRAINT item_status_pkey TO account_item_newness_pkey;
ALTER TABLE account_item_newness
  RENAME CONSTRAINT item_status_account_id_fkey TO account_item_newness_account_id_fkey;
ALTER TABLE account_item_newness
  RENAME CONSTRAINT item_status_account_id_item_type_item_id_key
              TO account_item_newness_account_id_item_type_item_id_key;

-- job_item_failure (was job_failure)
ALTER TABLE job_item_failure
  RENAME CONSTRAINT job_failure_pkey TO job_item_failure_pkey;
ALTER TABLE job_item_failure
  RENAME CONSTRAINT job_failure_job_id_fkey TO job_item_failure_job_id_fkey;

-- ============================================================================
-- 4. Rename trigger
-- ============================================================================

ALTER TRIGGER item_status_updated_at ON account_item_newness
  RENAME TO account_item_newness_updated_at;

-- ============================================================================
-- 5. Rename RLS policies
-- ============================================================================

ALTER POLICY job_failure_deny_all ON job_item_failure
  RENAME TO job_item_failure_deny_all;

ALTER POLICY item_status_deny_all ON account_item_newness
  RENAME TO account_item_newness_deny_all;

-- ============================================================================
-- 6. Drop old RPCs, create renamed replacements
--    The new function names do not exist yet, so CREATE (not CREATE OR REPLACE).
-- ============================================================================

DROP FUNCTION IF EXISTS resolve_stage_failures(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS count_unresolved_failures(UUID, UUID, TEXT, TEXT);

CREATE FUNCTION resolve_job_item_stage_failures(
  p_account_id UUID,
  p_item_id    UUID,
  p_stage      TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  UPDATE job_item_failure jf
  SET resolved_at = now()
  FROM job j
  WHERE jf.job_id = j.id
    AND jf.item_id = p_item_id
    AND jf.item_type = 'song'
    AND jf.stage = p_stage
    AND jf.is_terminal = FALSE
    AND jf.resolved_at IS NULL
    AND j.account_id = p_account_id;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$;

CREATE FUNCTION count_unresolved_job_item_failures(
  p_account_id   UUID,
  p_item_id      UUID,
  p_stage        TEXT,
  p_failure_code TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM job_item_failure jf
  INNER JOIN job j ON j.id = jf.job_id
  WHERE jf.item_id = p_item_id
    AND jf.item_type = 'song'
    AND jf.stage = p_stage
    AND jf.failure_code = p_failure_code
    AND jf.is_terminal = FALSE
    AND jf.resolved_at IS NULL
    AND j.account_id = p_account_id;
$$;

-- ============================================================================
-- 7. Recreate SQL functions that reference renamed tables.
--    CREATE OR REPLACE preserves existing GRANTs on the function name; only
--    use DROP + CREATE when the RETURNS shape changes, since CREATE OR REPLACE
--    cannot change a function's return-table signature.
-- ============================================================================

-- 7a. activate_unlimited_songs: item_status -> account_item_newness
CREATE OR REPLACE FUNCTION activate_unlimited_songs(
  p_account_id                      UUID,
  p_granted_stripe_subscription_id  TEXT,
  p_granted_subscription_period_end TIMESTAMPTZ
) RETURNS TABLE(song_id UUID)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH account_visible_songs AS (
    SELECT ls.song_id
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id
      )
  ),
  upsert_item_newness AS (
    INSERT INTO account_item_newness (account_id, item_type, item_id)
    SELECT p_account_id, 'song'::item_type, avs.song_id
    FROM account_visible_songs avs
    ON CONFLICT (account_id, item_type, item_id) DO NOTHING
  ),
  upsert_unlock AS (
    INSERT INTO account_song_unlock (
      account_id,
      song_id,
      source,
      granted_stripe_subscription_id,
      granted_subscription_period_end
    )
    SELECT
      p_account_id,
      avs.song_id,
      'unlimited',
      p_granted_stripe_subscription_id,
      p_granted_subscription_period_end
    FROM account_visible_songs avs
    ON CONFLICT (account_id, song_id) DO UPDATE
      SET source                          = 'unlimited',
          granted_stripe_subscription_id  = EXCLUDED.granted_stripe_subscription_id,
          granted_subscription_period_end = EXCLUDED.granted_subscription_period_end,
          revoked_at                      = NULL,
          revoked_reason                  = NULL,
          revoked_stripe_event_id         = NULL
      WHERE account_song_unlock.revoked_at IS NOT NULL
  )
  SELECT song_id FROM account_visible_songs;
$$;


-- 7b. select_liked_song_ids_needing_pipeline_processing:
--     job_failure -> job_item_failure, item_status -> account_item_newness
CREATE OR REPLACE FUNCTION select_liked_song_ids_needing_pipeline_processing(
  p_account_id UUID,
  p_limit INTEGER
)
RETURNS TABLE(song_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ls.song_id
  FROM liked_song ls
  INNER JOIN song s ON s.id = ls.song_id
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM job_item_failure jf
      INNER JOIN job j ON j.id = jf.job_id
      WHERE jf.item_id = ls.song_id
        AND jf.item_type = 'song'
        AND jf.is_terminal = TRUE
        AND j.account_id = p_account_id
    )
    AND (
      NOT EXISTS (SELECT 1 FROM song_audio_feature saf WHERE saf.song_id = ls.song_id)
      OR s.genres IS NULL OR array_length(s.genres, 1) IS NULL
      OR NOT EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
      OR NOT EXISTS (SELECT 1 FROM song_embedding se WHERE se.song_id = ls.song_id)
      OR NOT EXISTS (
        SELECT 1 FROM account_item_newness ain
        WHERE ain.account_id = p_account_id
          AND ain.item_type = 'song'
          AND ain.item_id = ls.song_id
      )
    )
  ORDER BY ls.liked_at DESC
  LIMIT p_limit;
$$;


-- 7c. select_liked_song_ids_needing_enrichment_work:
--     job_failure -> job_item_failure, item_status -> account_item_newness
CREATE OR REPLACE FUNCTION select_liked_song_ids_needing_enrichment_work(
  p_account_id UUID,
  p_limit      INTEGER
)
RETURNS TABLE(
  song_id                  UUID,
  needs_audio_features     BOOLEAN,
  needs_genre_tagging      BOOLEAN,
  needs_analysis           BOOLEAN,
  needs_embedding          BOOLEAN,
  needs_content_activation BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH billing_facts AS (
    SELECT COALESCE(
      (
        SELECT
          unlimited_access_source IS NOT NULL
          AND (
            unlimited_access_source = 'self_hosted'
            OR (
              unlimited_access_source = 'subscription'
              AND subscription_status = 'active'
            )
          )
        FROM account_billing
        WHERE account_id = p_account_id
      ),
      false
    ) AS has_unlimited_access
  ),
  song_with_entitlement AS (
    SELECT
      ls.song_id,
      ls.liked_at,
      s.genres,
      (
        bf.has_unlimited_access
        OR EXISTS (
          SELECT 1 FROM account_song_unlock asu
          WHERE asu.account_id = p_account_id
            AND asu.song_id = ls.song_id
            AND asu.revoked_at IS NULL
        )
      ) AS is_entitled
    FROM liked_song ls
    CROSS JOIN billing_facts bf
    INNER JOIN song s ON s.id = ls.song_id
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM job_item_failure jf
        INNER JOIN job j ON j.id = jf.job_id
        WHERE jf.item_id = ls.song_id
          AND jf.item_type = 'song'
          AND jf.is_terminal = TRUE
          AND j.account_id = p_account_id
      )
  ),
  song_with_flags AS (
    SELECT
      swe.song_id,
      swe.liked_at,

      (
        swe.is_entitled
        AND NOT EXISTS (
          SELECT 1 FROM song_audio_feature saf
          WHERE saf.song_id = swe.song_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM job_item_failure jf
          INNER JOIN job j ON j.id = jf.job_id
          WHERE jf.item_id = swe.song_id
            AND jf.item_type = 'song'
            AND jf.stage = 'audio_features'
            AND jf.is_terminal = FALSE
            AND jf.resolved_at IS NULL
            AND jf.suppress_until IS NOT NULL
            AND jf.suppress_until > now()
            AND j.account_id = p_account_id
        )
      ) AS needs_audio_features,

      (
        swe.is_entitled
        AND array_length(swe.genres, 1) IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM job_item_failure jf
          INNER JOIN job j ON j.id = jf.job_id
          WHERE jf.item_id = swe.song_id
            AND jf.item_type = 'song'
            AND jf.stage = 'genre_tagging'
            AND jf.is_terminal = FALSE
            AND jf.resolved_at IS NULL
            AND jf.suppress_until IS NOT NULL
            AND jf.suppress_until > now()
            AND j.account_id = p_account_id
        )
      ) AS needs_genre_tagging,

      (
        swe.is_entitled
        AND NOT EXISTS (
          SELECT 1 FROM song_analysis sa WHERE sa.song_id = swe.song_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM job_item_failure jf
          INNER JOIN job j ON j.id = jf.job_id
          WHERE jf.item_id = swe.song_id
            AND jf.item_type = 'song'
            AND jf.stage = 'song_analysis'
            AND jf.is_terminal = FALSE
            AND jf.resolved_at IS NULL
            AND jf.suppress_until IS NOT NULL
            AND jf.suppress_until > now()
            AND j.account_id = p_account_id
        )
      ) AS needs_analysis,

      (
        swe.is_entitled
        AND NOT EXISTS (
          SELECT 1 FROM song_embedding se WHERE se.song_id = swe.song_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM job_item_failure jf
          INNER JOIN job j ON j.id = jf.job_id
          WHERE jf.item_id = swe.song_id
            AND jf.item_type = 'song'
            AND jf.stage = 'song_embedding'
            AND jf.is_terminal = FALSE
            AND jf.resolved_at IS NULL
            AND jf.suppress_until IS NOT NULL
            AND jf.suppress_until > now()
            AND j.account_id = p_account_id
        )
      ) AS needs_embedding,

      (
        swe.is_entitled
        AND EXISTS (
          SELECT 1 FROM song_analysis sa WHERE sa.song_id = swe.song_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM account_item_newness ain
          WHERE ain.account_id = p_account_id
            AND ain.item_type = 'song'
            AND ain.item_id = swe.song_id
        )
      ) AS needs_content_activation

    FROM song_with_entitlement swe
  )
  SELECT
    swf.song_id,
    swf.needs_audio_features,
    swf.needs_genre_tagging,
    swf.needs_analysis,
    swf.needs_embedding,
    swf.needs_content_activation
  FROM song_with_flags swf
  WHERE swf.needs_audio_features
     OR swf.needs_genre_tagging
     OR swf.needs_analysis
     OR swf.needs_embedding
     OR swf.needs_content_activation
  ORDER BY swf.liked_at DESC
  LIMIT p_limit;
$$;


-- 7d. get_liked_songs_stats:
--     item_status -> account_item_newness, job_failure -> job_item_failure.
--     Signature is unchanged here; CREATE OR REPLACE preserves grants and
--     dependent function pointers. (DROP is unnecessary unless RETURNS changes.)

CREATE OR REPLACE FUNCTION get_liked_songs_stats(p_account_id UUID)
RETURNS TABLE (
  total           BIGINT,
  analyzed        BIGINT,
  matched         BIGINT,
  has_suggestions BIGINT,
  new_suggestions BIGINT,
  pending         BIGINT,
  locked          BIGINT
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
  WITH billing_facts AS (
    SELECT COALESCE(
      (
        SELECT
          ab.unlimited_access_source IS NOT NULL
          AND (
            ab.unlimited_access_source = 'self_hosted'
            OR (
              ab.unlimited_access_source = 'subscription'
              AND ab.subscription_status = 'active'
            )
          )
        FROM account_billing ab
        WHERE ab.account_id = p_account_id
      ),
      false
    ) AS has_unlimited_access
  ),
  entitled_songs AS (
    SELECT
      ls2.song_id,
      (
        bf.has_unlimited_access
        OR EXISTS (
          SELECT 1 FROM account_song_unlock asu
          WHERE asu.account_id = p_account_id
            AND asu.song_id = ls2.song_id
            AND asu.revoked_at IS NULL
        )
      ) AS is_entitled
    FROM liked_song ls2
    CROSS JOIN billing_facts bf
    WHERE ls2.account_id = p_account_id
      AND ls2.unliked_at IS NULL
  )
  SELECT
    COUNT(*)::BIGINT,

    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id
    ))::BIGINT,

    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
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
    ))::BIGINT,

    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    ))::BIGINT,

    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    ) AND EXISTS (
      SELECT 1 FROM account_item_newness ain
      WHERE ain.item_id = ls.song_id
        AND ain.account_id = ls.account_id
        AND ain.item_type = 'song'
        AND ain.is_new = true
    ))::BIGINT,

    COUNT(*) FILTER (
      WHERE ent.is_entitled
      AND NOT EXISTS (
        SELECT 1 FROM account_item_newness ain
        WHERE ain.item_id = ls.song_id
          AND ain.account_id = ls.account_id
          AND ain.item_type = 'song'
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_item_failure jf
        INNER JOIN job j ON j.id = jf.job_id
        WHERE jf.item_id = ls.song_id
          AND jf.item_type = 'song'
          AND jf.is_terminal = TRUE
          AND j.account_id = p_account_id
      )
    )::BIGINT,

    COUNT(*) FILTER (WHERE NOT ent.is_entitled)::BIGINT

  FROM liked_song ls
  JOIN entitled_songs ent ON ent.song_id = ls.song_id
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;


-- 7e. get_liked_songs_page:
--     item_status -> account_item_newness, job_failure -> job_item_failure
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
  display_state TEXT,
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
SET search_path = public
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
  WITH billing_facts AS (
    SELECT COALESCE(
      (
        SELECT
          ab.unlimited_access_source IS NOT NULL
          AND (
            ab.unlimited_access_source = 'self_hosted'
            OR (
              ab.unlimited_access_source = 'subscription'
              AND ab.subscription_status = 'active'
            )
          )
        FROM account_billing ab
        WHERE ab.account_id = p_account_id
      ),
      false
    ) AS has_unlimited_access
  ),
  entitled_songs AS (
    SELECT
      ls2.song_id,
      (
        bf.has_unlimited_access
        OR EXISTS (
          SELECT 1 FROM account_song_unlock asu
          WHERE asu.account_id = p_account_id
            AND asu.song_id = ls2.song_id
            AND asu.revoked_at IS NULL
        )
      ) AS is_entitled
    FROM liked_song ls2
    CROSS JOIN billing_facts bf
    WHERE ls2.account_id = p_account_id
      AND ls2.unliked_at IS NULL
  ),
  terminal_failures AS (
    SELECT DISTINCT jf.item_id AS song_id
    FROM job_item_failure jf
    INNER JOIN job j ON j.id = jf.job_id
    WHERE jf.item_type = 'song'
      AND jf.is_terminal = TRUE
      AND j.account_id = p_account_id
  )
  SELECT
    ls.id,
    ls.liked_at,

    CASE
      WHEN NOT ent.is_entitled THEN NULL
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count > 0 THEN 'has_suggestions'
      WHEN mr_agg.total_results > 0 AND mr_agg.undecided_count = 0 THEN 'acted'
      WHEN ain.id IS NOT NULL THEN 'no_suggestions'
      ELSE 'pending'
    END AS matching_status,

    CASE
      WHEN NOT ent.is_entitled THEN 'locked'
      WHEN sa.id IS NOT NULL THEN 'analyzed'
      WHEN tf.song_id IS NOT NULL THEN 'failed'
      ELSE 'pending'
    END AS display_state,

    s.id AS song_id,
    s.spotify_id AS song_spotify_id,
    s.name AS song_name,
    s.artists AS song_artists,
    s.artist_ids AS song_artist_ids,
    s.album_name AS song_album_name,
    s.image_url AS song_image_url,
    s.genres AS song_genres,
    a.image_url AS artist_image_url,

    CASE WHEN ent.is_entitled THEN sa.id ELSE NULL END AS analysis_id,
    CASE WHEN ent.is_entitled THEN sa.analysis ELSE NULL END AS analysis_content,
    CASE WHEN ent.is_entitled THEN sa.model ELSE NULL END AS analysis_model,
    CASE WHEN ent.is_entitled THEN sa.created_at ELSE NULL END AS analysis_created_at,

    saf.tempo AS audio_tempo,
    saf.energy AS audio_energy,
    saf.valence AS audio_valence

  FROM liked_song ls
  JOIN entitled_songs ent ON ent.song_id = ls.song_id
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
  LEFT JOIN account_item_newness ain
    ON ain.item_id = ls.song_id
    AND ain.account_id = ls.account_id
    AND ain.item_type = 'song'
  LEFT JOIN terminal_failures tf
    ON tf.song_id = ls.song_id
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
      OR (
        p_filter = 'pending'
        AND ain.id IS NULL
        AND ent.is_entitled
        AND tf.song_id IS NULL
      )
      OR (p_filter = 'has_suggestions' AND mr_agg.total_results > 0 AND mr_agg.undecided_count > 0)
      OR (p_filter = 'acted' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
      OR (p_filter = 'no_suggestions' AND ain.id IS NOT NULL AND COALESCE(mr_agg.total_results, 0) = 0)
      OR (p_filter = 'analyzed' AND sa.id IS NOT NULL)
      OR (p_filter = 'matched' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
      OR (p_filter = 'ignored' AND mr_agg.total_results > 0 AND mr_agg.undecided_count = 0)
    )
  ORDER BY ls.liked_at DESC
  LIMIT p_limit + 1;
END;
$$;

COMMIT;
