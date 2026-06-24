-- Introduce select_phase1_song_ids_needing_enrichment_work.
--
-- Phase-1 enrichment (audio features, genre tagging) produces deterministic,
-- non-ML signals that are cheap to acquire and benefit every user for the
-- playlist-creation feature. The existing selector gates ALL phases behind
-- entitlement; this new function lifts that gate for Phase-1 only:
--
--   * No is_entitled check — every actively-liked song without a terminal
--     failure is a candidate for audio_features and genre_tagging.
--   * Terminal-failure exclusion and transient-suppression windows are
--     preserved exactly as in select_liked_song_ids_needing_enrichment_work,
--     so the retry back-off behaviour is unchanged.
--   * audio_feature_state() semantics are preserved: a song with a backfill
--     job in flight (backfill_active) is not re-offered.
--   * Columns needs_analysis, needs_embedding, needs_content_activation are
--     intentionally absent — those stages remain entitlement-gated via the
--     existing select_liked_song_ids_needing_enrichment_work function.
--
-- The TypeScript layer (batch.ts) merges both selectors so that Phase-1 work
-- is driven for all users while Phase-2/3 (LLM analysis, embeddings, content
-- activation) are still restricted to entitled songs only.

CREATE OR REPLACE FUNCTION select_phase1_song_ids_needing_enrichment_work(
  p_account_id UUID,
  p_limit      INTEGER
)
RETURNS TABLE(
  song_id              UUID,
  needs_audio_features BOOLEAN,
  needs_genre_tagging  BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH song_candidates AS (
    SELECT
      ls.song_id,
      ls.liked_at,
      s.genres
    FROM liked_song ls
    INNER JOIN song s ON s.id = ls.song_id
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
      -- Exclude songs with any terminal failure (same rule as the full selector)
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
      sc.song_id,
      sc.liked_at,

      -- Mirrors the audio_features flag from the entitlement-gated selector
      -- but without the is_entitled prerequisite.
      (
        audio_feature_state(sc.song_id) = 'absent'
        AND NOT EXISTS (
          SELECT 1 FROM job_item_failure jf
          INNER JOIN job j ON j.id = jf.job_id
          WHERE jf.item_id = sc.song_id
            AND jf.item_type = 'song'
            AND jf.stage = 'audio_features'
            AND jf.is_terminal = FALSE
            AND jf.resolved_at IS NULL
            AND jf.suppress_until IS NOT NULL
            AND jf.suppress_until > now()
            AND j.account_id = p_account_id
        )
      ) AS needs_audio_features,

      -- Mirrors the genre_tagging flag from the entitlement-gated selector
      -- but without the is_entitled prerequisite.
      (
        array_length(sc.genres, 1) IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM job_item_failure jf
          INNER JOIN job j ON j.id = jf.job_id
          WHERE jf.item_id = sc.song_id
            AND jf.item_type = 'song'
            AND jf.stage = 'genre_tagging'
            AND jf.is_terminal = FALSE
            AND jf.resolved_at IS NULL
            AND jf.suppress_until IS NOT NULL
            AND jf.suppress_until > now()
            AND j.account_id = p_account_id
        )
      ) AS needs_genre_tagging

    FROM song_candidates sc
  )
  SELECT
    swf.song_id,
    swf.needs_audio_features,
    swf.needs_genre_tagging
  FROM song_with_flags swf
  WHERE swf.needs_audio_features
     OR swf.needs_genre_tagging
  ORDER BY swf.liked_at DESC
  LIMIT p_limit;
$$;

-- Restrict to the service-role backend client; must not be callable by anon or
-- authenticated JWT holders directly (same posture as the entitlement-gated selector).
REVOKE EXECUTE ON FUNCTION
  public.select_phase1_song_ids_needing_enrichment_work(UUID, INTEGER)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.select_phase1_song_ids_needing_enrichment_work(UUID, INTEGER)
TO service_role;
