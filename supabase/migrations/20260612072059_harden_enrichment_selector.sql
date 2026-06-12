-- Harden select_liked_song_ids_needing_enrichment_work (Decision 6).
--
-- Two surgical changes to the song_with_flags CTE; everything else is
-- reproduced verbatim from the 20260517072352_normalize_database_vocabulary
-- migration, which is the authoritative current definition.
--
-- Change 1 — needs_embedding now requires song_analysis to exist.
--   The incident (account 612d2e86…, song "Crossing Paths") showed that a song
--   whose analysis is blocked keeps needs_embedding = true indefinitely because
--   the embedding stage silently skips when its input is missing, writing no
--   failure row and no suppression window. Adding EXISTS (song_analysis) means
--   the flag is only true when the stage could actually run.
--
-- Change 2 — needs_content_activation gains the same suppress_until suppression
--   branch every other stage flag already has. Previously CONTENT_ACTIVATION_FAILED
--   (failure_code = 'content_activation_failed', stage = 'content_activation')
--   wrote a suppress_until window but the selector never checked it, making the
--   suppression dead code.
--
-- All other behavior (billing_facts CTE, entitlement check, terminal exclusion,
-- audio_features / genre_tagging / song_analysis suppression branches, ORDER BY,
-- LIMIT) is unchanged.

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

      -- Change 1: additionally requires song_analysis to exist so that a song
      -- whose analysis is blocked is never flagged as actionable for embedding.
      (
        swe.is_entitled
        AND EXISTS (
          SELECT 1 FROM song_analysis sa WHERE sa.song_id = swe.song_id
        )
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

      -- Change 2: add the same suppress_until suppression branch all other
      -- stage flags have — CONTENT_ACTIVATION_FAILED already writes a 6h
      -- window but the selector was not checking it.
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
