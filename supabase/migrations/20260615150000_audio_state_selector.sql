-- Make the enrichment selector audio-availability-state driven (yt-dlp backfill).
--
-- Two changes vs. 20260612072059_harden_enrichment_selector (everything else is
-- reproduced verbatim):
--
-- Change 1 — needs_audio_features = is_entitled AND audio_feature_state = 'absent'
--   AND no active audio_features transient-suppression row.
--   'absent' already means "no song_audio_feature row AND no active/terminal/
--   manual backfill job", so the state check replaces both the feature-existence
--   check and the old source_not_found suppress_until window (catalog misses now
--   enqueue a backfill job → backfill_active, never 'absent'). The transient
--   suppress_until window is preserved so a flaky ReccoBeats catalog endpoint
--   still gets its Retry-After backoff instead of being re-hammered every sweep.
--   A song with an in-flight or terminal backfill job is no longer re-offered.
--
-- Change 2 — needs_analysis additionally requires the song is NOT backfill_active.
--   This is what makes LLM analysis wait while yt-dlp might still land audio
--   features. Once backfill settles (ready / manual_needed / unavailable_terminal),
--   analysis may proceed with the feature if present, or the existing
--   input-missing / lyrics-only behavior if not.
--
-- Finally, resolve any leftover non-terminal source_not_found audio_features
-- failure rows from the pre-backfill behavior so their 30-day suppression can't
-- block the new backfill path.

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

      -- Change 1: audio availability state replaces the feature-existence check
      -- and the source_not_found suppress_until window. The transient suppress
      -- window is kept: a catalog miss now enqueues a backfill job (state moves
      -- to backfill_active, not 'absent'), so the only audio_features failure
      -- rows that remain are PROVIDER_TRANSIENT, whose Retry-After backoff must
      -- still be honored instead of re-hammering the catalog every sweep.
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

      -- Change 2: never analyze while an audio-feature backfill is in flight.
      (
        swe.is_entitled
        AND NOT EXISTS (
          SELECT 1 FROM song_analysis sa WHERE sa.song_id = swe.song_id
        )
        AND audio_feature_state(swe.song_id) <> 'backfill_active'
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

-- Clear pre-backfill source_not_found suppression so it can't mask the new path.
UPDATE job_item_failure
SET resolved_at = now()
WHERE stage = 'audio_features'
  AND failure_code = 'source_not_found'
  AND is_terminal = FALSE
  AND resolved_at IS NULL;
