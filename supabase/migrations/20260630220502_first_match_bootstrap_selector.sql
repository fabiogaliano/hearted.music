-- Bootstrap enrichment selector: orders by readiness_rank before liked_at so
-- near-ready songs are processed first when no first visible match card exists.
--
-- Why a new function rather than modifying the existing one: the normal selector's
-- recency-first ordering is correct for steady-state background enrichment; a
-- separate function avoids adding a runtime branch or changing the schema of a
-- hot path used by every enrichment worker tick.
--
-- Readiness rank ordering (lower = fewer stages left before match candidacy):
--   1 — has analysis + embedding + genres, needs only content_activation
--   2 — has analysis + genres, needs only embedding (+ content_activation follows)
--   3 — has analysis + embedding, needs only genre_tagging (+ content_activation follows)
--   4 — has analysis, missing genres and/or embedding (but not audio_features)
--   5 — needs analysis or audio_features (most work remaining)
--
-- The WHERE clause and all flag definitions are identical to the current
-- select_liked_song_ids_needing_enrichment_work (20260623160000); only the
-- final SELECT ordering differs. The RETURNS TABLE signature is also identical
-- so the TypeScript cast in batch.ts remains accurate after gen:types is run.
--
-- NOTIFY at the end is required: PostgREST caches its schema; without a reload
-- signal the new function is invisible to the client until the next restart.
-- (Stale schema cache has caused production failures — see CLAUDE.md notes.)

CREATE OR REPLACE FUNCTION select_liked_song_ids_needing_first_match_enrichment_work(
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
  latest_analysis AS (
    SELECT DISTINCT ON (sa.song_id)
      sa.song_id,
      sa.created_at AS analysis_created_at
    FROM song_analysis sa
    INNER JOIN song_with_entitlement swe ON swe.song_id = sa.song_id
    ORDER BY sa.song_id, sa.created_at DESC
  ),
  latest_fetch AS (
    SELECT DISTINCT ON (sl.song_id)
      sl.song_id,
      sl.fetch_status,
      sl.updated_at AS fetch_updated_at
    FROM song_lyrics sl
    INNER JOIN song_with_entitlement swe ON swe.song_id = sl.song_id
    ORDER BY sl.song_id, sl.updated_at DESC
  ),
  latest_lyrics AS (
    SELECT DISTINCT ON (sl.song_id)
      sl.song_id,
      sl.updated_at AS lyrics_updated_at
    FROM song_lyrics sl
    INNER JOIN song_with_entitlement swe ON swe.song_id = sl.song_id
    WHERE sl.fetch_status = 'lyrics'
    ORDER BY sl.song_id, sl.updated_at DESC
  ),
  song_with_flags AS (
    SELECT
      swe.song_id,
      swe.liked_at,
      swe.genres,
      swe.is_entitled,
      la.analysis_created_at,
      lf.fetch_status,
      ll.lyrics_updated_at,

      (
        swe.is_entitled
        AND audio_feature_state(swe.song_id) = 'absent'
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
        AND audio_feature_state(swe.song_id) <> 'backfill_active'
        AND (
          la.analysis_created_at IS NULL
          OR (
            ll.lyrics_updated_at IS NOT NULL
            AND ll.lyrics_updated_at > la.analysis_created_at
          )
          OR (
            la.analysis_created_at IS NOT NULL
            AND ll.lyrics_updated_at IS NULL
            AND (lf.fetch_status IS NULL OR lf.fetch_status = 'not_found')
          )
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
        AND la.analysis_created_at IS NOT NULL
        AND (
          NOT EXISTS (
            SELECT 1 FROM song_embedding se WHERE se.song_id = swe.song_id
          )
          OR (
            SELECT MAX(se.created_at) FROM song_embedding se
            WHERE se.song_id = swe.song_id
          ) < la.analysis_created_at
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
        AND NOT EXISTS (
          SELECT 1 FROM job_item_failure jf
          INNER JOIN job j ON j.id = jf.job_id
          WHERE jf.item_id = swe.song_id
            AND jf.item_type = 'song'
            AND jf.stage = 'content_activation'
            AND jf.is_terminal = FALSE
            AND jf.resolved_at IS NULL
            AND jf.suppress_until IS NOT NULL
            AND jf.suppress_until > now()
            AND j.account_id = p_account_id
        )
      ) AS needs_content_activation

    FROM song_with_entitlement swe
    LEFT JOIN latest_analysis la ON la.song_id = swe.song_id
    LEFT JOIN latest_fetch lf ON lf.song_id = swe.song_id
    LEFT JOIN latest_lyrics ll ON ll.song_id = swe.song_id
  ),
  ranked AS (
    SELECT
      swf.song_id,
      swf.liked_at,
      swf.needs_audio_features,
      swf.needs_genre_tagging,
      swf.needs_analysis,
      swf.needs_embedding,
      swf.needs_content_activation,
      CASE
        -- rank 1: analysis + genres + embedding done; only content_activation remains
        WHEN NOT swf.needs_analysis
             AND NOT swf.needs_audio_features
             AND NOT swf.needs_embedding
             AND NOT swf.needs_genre_tagging
        THEN 1
        -- rank 2: analysis + genres done; only embedding (and content_activation) remains
        WHEN NOT swf.needs_analysis
             AND NOT swf.needs_audio_features
             AND NOT swf.needs_genre_tagging
             AND swf.needs_embedding
        THEN 2
        -- rank 3: analysis + embedding done; only genre_tagging (and content_activation) remains
        WHEN NOT swf.needs_analysis
             AND NOT swf.needs_audio_features
             AND NOT swf.needs_embedding
             AND swf.needs_genre_tagging
        THEN 3
        -- rank 4: analysis done but missing genres and/or embedding
        WHEN NOT swf.needs_analysis
             AND NOT swf.needs_audio_features
        THEN 4
        -- rank 5: needs analysis or audio_features (most work remaining)
        ELSE 5
      END AS readiness_rank
    FROM song_with_flags swf
    WHERE swf.needs_audio_features
       OR swf.needs_genre_tagging
       OR swf.needs_analysis
       OR swf.needs_embedding
       OR swf.needs_content_activation
  )
  SELECT
    r.song_id,
    r.needs_audio_features,
    r.needs_genre_tagging,
    r.needs_analysis,
    r.needs_embedding,
    r.needs_content_activation
  FROM ranked r
  ORDER BY r.readiness_rank ASC, r.liked_at DESC
  LIMIT p_limit;
$$;

-- SECURITY DEFINER runs with the owner's rights, so lock execution down to the
-- worker's service_role only. Without this, PUBLIC (and thus anon/authenticated)
-- would inherit the default EXECUTE grant on the function.
REVOKE ALL ON FUNCTION public.select_liked_song_ids_needing_first_match_enrichment_work(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_liked_song_ids_needing_first_match_enrichment_work(uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
