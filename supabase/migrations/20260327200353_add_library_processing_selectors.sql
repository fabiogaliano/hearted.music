-- DB-side selectors for enrichment and refresh candidate loading.
-- Replaces giant app-side exclusion lists that can exceed PostgREST URL limits.

-- Full-pipeline selector: returns liked song IDs that still need pipeline processing.
-- A song needs processing when:
--   1. It is missing any of the 4 shared artifacts (audio_feature, genres, analysis, embedding), OR
--   2. It has all 4 shared artifacts but is missing account-scoped item_status
-- Terminal failures are excluded via DB-side join.
CREATE OR REPLACE FUNCTION select_liked_song_ids_needing_pipeline_processing(
  p_account_id UUID,
  p_limit INTEGER
)
RETURNS TABLE(song_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT ls.song_id
  FROM liked_song ls
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
    -- Song still needs work: missing shared artifact OR missing item_status
    AND (
      NOT EXISTS (SELECT 1 FROM song_audio_feature saf WHERE saf.song_id = ls.song_id)
      OR s.genres IS NULL OR array_length(s.genres, 1) IS NULL
      OR NOT EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
      OR NOT EXISTS (SELECT 1 FROM song_embedding se WHERE se.song_id = ls.song_id)
      OR NOT EXISTS (
        SELECT 1 FROM item_status ist
        WHERE ist.account_id = p_account_id
          AND ist.item_type = 'song'
          AND ist.item_id = ls.song_id
      )
    )
  ORDER BY ls.liked_at DESC
  LIMIT p_limit;
$$;

-- Data-enrichment selector: returns liked song IDs that have all 4 shared artifacts.
-- Used by match snapshot refresh for candidate loading.
-- Does NOT require account-scoped item_status (preserving current refresh semantics).
-- Does NOT exclude terminal failures (refresh eligibility is separate from pipeline work).
CREATE OR REPLACE FUNCTION select_data_enriched_liked_song_ids(
  p_account_id UUID
)
RETURNS TABLE(song_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT ls.song_id
  FROM liked_song ls
  INNER JOIN song s ON s.id = ls.song_id
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    AND EXISTS (SELECT 1 FROM song_audio_feature saf WHERE saf.song_id = ls.song_id)
    AND s.genres IS NOT NULL AND array_length(s.genres, 1) IS NOT NULL
    AND EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
    AND EXISTS (SELECT 1 FROM song_embedding se WHERE se.song_id = ls.song_id);
$$;
