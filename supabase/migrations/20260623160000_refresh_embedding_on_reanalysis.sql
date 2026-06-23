-- Refresh embeddings when a song is re-analyzed (late lyrics arriving).
--
-- Why: needs_embedding previously gated on NOT EXISTS(song_embedding), so once a
-- song had any embedding it was never re-offered — even after the lyrics-refresh
-- selector re-analyzed it instrumental->lyrical. The fresh, lyrics-informed
-- song_analysis row got a stale (instrumental-era) embedding that no path would
-- replace. This re-opens needs_embedding when the latest embedding predates the
-- latest analysis; the embedding stage and service then dedupe by content_hash,
-- so an unchanged analysis is a cheap no-op while a changed one regenerates.
--
-- Only the needs_embedding clause changes; every other flag is identical to
-- 20260623103000_reopen_analyzed_songs_for_lyrics_refresh.

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
