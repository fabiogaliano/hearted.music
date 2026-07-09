-- Introduce select_phase1_song_ids_needing_enrichment_work.
--
-- Phase-1 enrichment (audio features, genre tagging) produces deterministic,
-- non-ML signals that are cheap to acquire and power the playlist-creation
-- preview engine for every user. The account-wide selectors
-- (select_liked_song_ids_needing_enrichment_work and its bootstrap sibling
-- select_liked_song_ids_needing_first_match_enrichment_work) gate ALL stages
-- behind is_entitled; this function lifts that gate for Phase-1 only so free
-- users get audio_features and genre_tagging across their ENTIRE liked library.
--
--   * No is_entitled check — every actively-liked song without a terminal
--     failure is a candidate for audio_features and genre_tagging.
--   * The needs_audio_features / needs_genre_tagging flag bodies are copied
--     verbatim from select_liked_song_ids_needing_first_match_enrichment_work
--     (20260630220502) minus the is_entitled conjunct: same audio_feature_state()
--     'absent' test, same array_length(genres) test, same terminal-failure
--     exclusion and same transient-suppression window, so retry back-off is
--     unchanged.
--   * Columns needs_analysis, needs_embedding, needs_content_activation are
--     intentionally absent — those Phase-2/3 stages stay entitlement-gated via
--     the existing account-wide selectors. batch.ts unions this selector with
--     the gated one so Phase-1 runs for all users while ML stages do not.
--
-- NOTIFY at the end is required: PostgREST caches its schema; without a reload
-- signal the new function is invisible to the client until the next restart.
-- (Stale schema cache has caused production failures — see CLAUDE.md notes.)

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
      -- Exclude songs with any terminal failure (same rule as the gated selectors).
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

-- SECURITY DEFINER runs with the owner's rights, so lock execution down to the
-- worker's service_role only. Without this, PUBLIC (and thus anon/authenticated)
-- would inherit the default EXECUTE grant on the function.
REVOKE ALL ON FUNCTION public.select_phase1_song_ids_needing_enrichment_work(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_phase1_song_ids_needing_enrichment_work(uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
