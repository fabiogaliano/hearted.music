-- Release-year counts for the playlist-creation seed stage, aggregated over
-- select_entitled_data_enriched_liked_song_ids.
--
-- 20260713000000 copied the entitled + data-enriched predicate (billing facts,
-- unlock rows, required artifacts) inline, so a change to who is entitled had
-- to be made in two places. Selecting from the shared selector, as
-- get_account_match_filter_options does, leaves it with one owner. The
-- predicates were identical, so results are unchanged.
--
-- Same signature, return type, volatility, security and ACL as before.
-- Backend-private: callable only through the service-role client.

CREATE OR REPLACE FUNCTION get_account_release_year_counts(
  p_account_id UUID
)
RETURNS TABLE (release_year INTEGER, occurrences BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.release_year, COUNT(*)::BIGINT AS occurrences
  FROM select_entitled_data_enriched_liked_song_ids(p_account_id) e
  INNER JOIN song s ON s.id = e.song_id
  WHERE s.release_year IS NOT NULL
  GROUP BY s.release_year
  ORDER BY s.release_year ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_account_release_year_counts(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_account_release_year_counts(UUID)
  TO service_role;
