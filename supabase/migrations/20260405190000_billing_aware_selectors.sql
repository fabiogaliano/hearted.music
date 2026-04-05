-- S1-11: Billing-aware enrichment and match-refresh selector RPCs
-- Depends on: billing_core_tables (S1-01), entitlement_predicate (S1-04)
-- These selectors complement (not replace) the legacy ungated selectors;
-- removal of legacy selectors is deferred to Phase 3 orchestrator rewire.

-- Enrichment work selector: returns liked songs that have at least one outstanding
-- enrichment stage, with per-stage flags. Phase A flags (audio_features,
-- genre_tagging) are returned regardless of entitlement. Phase B/C flags
-- (analysis, embedding) and content_activation require effective entitlement.
--
-- Returns TABLE(
--   song_id                 UUID,
--   needs_audio_features    BOOLEAN,
--   needs_genre_tagging     BOOLEAN,
--   needs_analysis          BOOLEAN,
--   needs_embedding         BOOLEAN,
--   needs_content_activation BOOLEAN
-- )
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
    -- Compute unlimited-access status once for the account to avoid per-row
    -- lookups against account_billing.
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
  )
  SELECT
    ls.song_id,

    -- Phase A: shared artifact missing — no entitlement gate
    NOT EXISTS (
      SELECT 1 FROM song_audio_feature saf WHERE saf.song_id = ls.song_id
    ) AS needs_audio_features,

    (array_length(s.genres, 1) IS NULL)
      AS needs_genre_tagging,

    -- Phase B: entitled AND analysis missing
    (
      (bf.has_unlimited_access OR EXISTS (
        SELECT 1 FROM account_song_unlock asu
        WHERE asu.account_id = p_account_id
          AND asu.song_id = ls.song_id
          AND asu.revoked_at IS NULL
      ))
      AND NOT EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
    ) AS needs_analysis,

    -- Phase C: entitled AND embedding missing
    (
      (bf.has_unlimited_access OR EXISTS (
        SELECT 1 FROM account_song_unlock asu
        WHERE asu.account_id = p_account_id
          AND asu.song_id = ls.song_id
          AND asu.revoked_at IS NULL
      ))
      AND NOT EXISTS (SELECT 1 FROM song_embedding se WHERE se.song_id = ls.song_id)
    ) AS needs_embedding,

    -- Content activation: entitled AND analysis exists AND item_status missing
    (
      (bf.has_unlimited_access OR EXISTS (
        SELECT 1 FROM account_song_unlock asu
        WHERE asu.account_id = p_account_id
          AND asu.song_id = ls.song_id
          AND asu.revoked_at IS NULL
      ))
      AND EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
      AND NOT EXISTS (
        SELECT 1 FROM item_status ist
        WHERE ist.account_id = p_account_id
          AND ist.item_type = 'song'
          AND ist.item_id = ls.song_id
      )
    ) AS needs_content_activation

  FROM liked_song ls
  CROSS JOIN billing_facts bf
  INNER JOIN song s ON s.id = ls.song_id

  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL

    -- Exclude terminal failures for this account
    AND NOT EXISTS (
      SELECT 1 FROM job_failure jf
      INNER JOIN job j ON j.id = jf.job_id
      WHERE jf.item_id = ls.song_id
        AND jf.item_type = 'song'
        AND jf.error_type IN ('validation', 'unsupported', 'auth', 'permanent')
        AND j.account_id = p_account_id
    )

    -- Return song only when at least one flag would be true:
    -- Phase A work (no entitlement needed)
    AND (
      NOT EXISTS (SELECT 1 FROM song_audio_feature saf WHERE saf.song_id = ls.song_id)
      OR array_length(s.genres, 1) IS NULL
      -- Phase B/C/activation work (entitlement required)
      OR (
        (bf.has_unlimited_access OR EXISTS (
          SELECT 1 FROM account_song_unlock asu
          WHERE asu.account_id = p_account_id
            AND asu.song_id = ls.song_id
            AND asu.revoked_at IS NULL
        ))
        AND (
          NOT EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
          OR NOT EXISTS (SELECT 1 FROM song_embedding se WHERE se.song_id = ls.song_id)
          -- content_activation guard: analysis must exist for this to be the sole reason
          OR (
            EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
            AND NOT EXISTS (
              SELECT 1 FROM item_status ist
              WHERE ist.account_id = p_account_id
                AND ist.item_type = 'song'
                AND ist.item_id = ls.song_id
            )
          )
        )
      )
    )

  ORDER BY ls.liked_at DESC
  LIMIT p_limit;
$$;


-- Match-refresh candidate selector: returns liked songs that have all four shared
-- artifacts AND effective entitlement. Used by the orchestrator to build match
-- snapshot refresh candidate sets. Does NOT require item_status.
CREATE OR REPLACE FUNCTION select_entitled_data_enriched_liked_song_ids(
  p_account_id UUID
)
RETURNS TABLE(song_id UUID)
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
  )
  SELECT ls.song_id
  FROM liked_song ls
  CROSS JOIN billing_facts bf
  INNER JOIN song s ON s.id = ls.song_id

  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL

    -- All four shared artifacts must exist
    AND EXISTS (SELECT 1 FROM song_audio_feature saf WHERE saf.song_id = ls.song_id)
    AND array_length(s.genres, 1) IS NOT NULL
    AND EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
    AND EXISTS (SELECT 1 FROM song_embedding se WHERE se.song_id = ls.song_id)

    -- Effective entitlement: active unlock row OR unlimited access
    AND (
      bf.has_unlimited_access
      OR EXISTS (
        SELECT 1 FROM account_song_unlock asu
        WHERE asu.account_id = p_account_id
          AND asu.song_id = ls.song_id
          AND asu.revoked_at IS NULL
      )
    );
$$;
