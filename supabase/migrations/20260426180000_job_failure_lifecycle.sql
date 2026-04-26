-- Lifecycle metadata for job_failure: resolved_at + suppress_until.
--
-- Powers time-bounded selector suppression and automatic recovery without
-- operator scripts. The selector treats any non-terminal row with an active
-- suppress_until window as a temporary block; once the window expires the
-- song re-enters the work queue. Stage-success handlers flip resolved_at
-- so the historical row stops blocking immediately.
--
-- Preprod-only clean break: existing non-terminal rows are unbounded and
-- currently wedge the selector. Backfill gives them a 6h suppression window
-- from creation; rows older than 6h expire on first read, which is what we
-- want — the underlying providers have almost certainly recovered by now.

ALTER TABLE job_failure
  ADD COLUMN resolved_at    TIMESTAMPTZ NULL,
  ADD COLUMN suppress_until TIMESTAMPTZ NULL;

UPDATE job_failure
SET suppress_until = created_at + INTERVAL '6 hours'
WHERE is_terminal = FALSE
  AND resolved_at IS NULL
  AND suppress_until IS NULL;

-- Partial index sized to active suppression rows only. Covers the dominant
-- selector path (per-song stage lookup) and the resolve / count helpers.
CREATE INDEX idx_job_failure_active_suppression
  ON job_failure (item_id, item_type, stage, suppress_until)
  WHERE is_terminal = FALSE AND resolved_at IS NULL;

-- Atomic helpers used by the data layer. Exposed as RPCs so the lookup-then-
-- update pattern (resolve) and aggregate (count) run server-side instead of
-- round-tripping ids through the client.
CREATE OR REPLACE FUNCTION resolve_stage_failures(
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
  UPDATE job_failure jf
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

CREATE OR REPLACE FUNCTION count_unresolved_failures(
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
  FROM job_failure jf
  INNER JOIN job j ON j.id = jf.job_id
  WHERE jf.item_id = p_item_id
    AND jf.item_type = 'song'
    AND jf.stage = p_stage
    AND jf.failure_code = p_failure_code
    AND jf.is_terminal = FALSE
    AND jf.resolved_at IS NULL
    AND j.account_id = p_account_id;
$$;


-- Override the enrichment selector with lifecycle suppression. Every Phase A
-- and Phase B stage flag now also requires the absence of an active
-- non-terminal suppression for that stage. Terminal exclusion at the song-
-- with-entitlement CTE is unchanged.
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
          SELECT 1 FROM job_failure jf
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
          SELECT 1 FROM job_failure jf
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
          SELECT 1 FROM job_failure jf
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
