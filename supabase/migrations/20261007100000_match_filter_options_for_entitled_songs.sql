-- Match-filter options for one account, aggregated over its matching-eligible
-- population (the get_account_* family of per-account aggregates).
--
-- The filter-options server fn used to read the whole entitled song-id set and
-- feed it back through three chunked PostgREST .in() reads (song languages,
-- release years, liked_at). This computes the same aggregates in one statement
-- over select_entitled_data_enriched_liked_song_ids, so option counts and
-- bounds stay aligned with what matching sees and no DB-derived id set
-- re-enters a query.
--
-- Returns one jsonb object rather than rows: the result is three small,
-- differently-shaped aggregates (bounded by the language catalog and the
-- span of years), not a row set that could hit the PostgREST row cap.
--
-- Additive only: select_entitled_data_enriched_liked_song_ids is unchanged.
-- Backend-private: callable only through the service-role client.

CREATE OR REPLACE FUNCTION get_account_match_filter_options(
  p_account_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH entitled AS (
    SELECT e.song_id
    FROM select_entitled_data_enriched_liked_song_ids(p_account_id) e
  ),
  -- DISTINCT per (song, code): a song whose primary and secondary language
  -- agree must count once, and a bilingual song counts once for each code.
  song_language AS (
    SELECT DISTINCT e.song_id, l.code
    FROM entitled e
    INNER JOIN song s ON s.id = e.song_id
    CROSS JOIN LATERAL (VALUES (s.language), (s.language_secondary)) AS l(code)
    WHERE l.code IS NOT NULL
  ),
  language_counts AS (
    SELECT code, COUNT(*)::INTEGER AS count
    FROM song_language
    GROUP BY code
  ),
  release_year_counts AS (
    SELECT s.release_year AS year, COUNT(*)::INTEGER AS count
    FROM entitled e
    INNER JOIN song s ON s.id = e.song_id
    WHERE s.release_year IS NOT NULL
    GROUP BY s.release_year
  ),
  liked AS (
    SELECT ls.liked_at AT TIME ZONE 'UTC' AS liked_at_utc
    FROM entitled e
    INNER JOIN liked_song ls
      ON ls.song_id = e.song_id
     AND ls.account_id = p_account_id
     AND ls.unliked_at IS NULL
  ),
  liked_year_counts AS (
    SELECT EXTRACT(YEAR FROM liked_at_utc)::INTEGER AS year, COUNT(*)::INTEGER AS count
    FROM liked
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'languages', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('code', code, 'count', count) ORDER BY count DESC, code)
       FROM language_counts),
      '[]'::jsonb
    ),
    'releaseYears', jsonb_build_object(
      'min', (SELECT MIN(year) FROM release_year_counts),
      'max', (SELECT MAX(year) FROM release_year_counts),
      'counts', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('year', year, 'count', count) ORDER BY year)
         FROM release_year_counts),
        '[]'::jsonb
      )
    ),
    'likedAt', jsonb_build_object(
      'oldest', (SELECT to_char(MIN(liked_at_utc), 'YYYY-MM-DD') FROM liked),
      'yearCounts', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('year', year, 'count', count) ORDER BY year)
         FROM liked_year_counts),
        '[]'::jsonb
      )
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_account_match_filter_options(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_account_match_filter_options(UUID)
  TO service_role;
