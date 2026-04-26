-- Gate Phase A enrichment work (audio_features, genre_tagging) by entitlement
-- and suppress retries for optional signals that are definitively unavailable
-- from their upstream source.
--
-- Behavior change vs. the prior definition (preprod-only clean break):
--   * needs_audio_features and needs_genre_tagging now require effective
--     entitlement, matching the existing Phase B/C/activation gates. Previously
--     these stages ran for any liked song regardless of unlock status, which
--     billed external providers for songs the user couldn't see anyway.
--   * If a non-terminal source_not_found marker exists for a song's stage, the
--     corresponding flag is suppressed. ReccoBeats-not-in-catalog and
--     Last.fm-no-genre are recorded as is_terminal = false (since catalogs
--     can update), but retrying them on every selector pass wastes API budget
--     and stacks duplicate failure rows. The song stays selectable for
--     analysis / embedding / activation — only the missing optional signal is
--     masked off.
--
-- Other selector functions (pipeline_processing, entitled_data_enriched,
-- match-aware page) are unchanged and continue to use is_terminal exclusion.

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
        SELECT 1 FROM job_failure jf
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

      -- Phase A: entitled AND artifact missing AND no source_not_found marker.
      -- The source_not_found check stops perpetual retries for optional signals
      -- the upstream provider has already declined.
      (
        swe.is_entitled
        AND NOT EXISTS (
          SELECT 1 FROM song_audio_feature saf
          WHERE saf.song_id = swe.song_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM job_failure jf
          INNER JOIN job j ON j.id = jf.job_id
          WHERE jf.item_id = swe.song_id
            AND jf.item_type = 'song'
            AND jf.stage = 'audio_features'
            AND jf.failure_code = 'source_not_found'
            AND j.account_id = p_account_id
        )
      ) AS needs_audio_features,

      (
        swe.is_entitled
        AND array_length(swe.genres, 1) IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM job_failure jf
          INNER JOIN job j ON j.id = jf.job_id
          WHERE jf.item_id = swe.song_id
            AND jf.item_type = 'song'
            AND jf.stage = 'genre_tagging'
            AND jf.failure_code = 'source_not_found'
            AND j.account_id = p_account_id
        )
      ) AS needs_genre_tagging,

      -- Phase B: entitled AND analysis missing
      (
        swe.is_entitled
        AND NOT EXISTS (
          SELECT 1 FROM song_analysis sa WHERE sa.song_id = swe.song_id
        )
      ) AS needs_analysis,

      -- Phase C: entitled AND embedding missing
      (
        swe.is_entitled
        AND NOT EXISTS (
          SELECT 1 FROM song_embedding se WHERE se.song_id = swe.song_id
        )
      ) AS needs_embedding,

      -- Content activation: entitled AND analysis exists AND item_status missing
      (
        swe.is_entitled
        AND EXISTS (
          SELECT 1 FROM song_analysis sa WHERE sa.song_id = swe.song_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM item_status ist
          WHERE ist.account_id = p_account_id
            AND ist.item_type = 'song'
            AND ist.item_id = swe.song_id
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
