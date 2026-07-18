-- Release-year counts for the playlist-creation seed stage.
--
-- Computes the same matching-eligible population as
-- select_entitled_data_enriched_liked_song_ids, then aggregates release years in
-- SQL. The caller passes only the account id, so no DB-derived id set re-enters
-- PostgREST as a URL .in() filter.
--
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
  SELECT s.release_year, COUNT(*)::BIGINT AS occurrences
  FROM liked_song ls
  CROSS JOIN billing_facts bf
  INNER JOIN song s ON s.id = ls.song_id
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    AND s.release_year IS NOT NULL
    AND array_length(s.genres, 1) IS NOT NULL
    AND EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
    AND EXISTS (SELECT 1 FROM song_embedding se WHERE se.song_id = ls.song_id)
    AND (
      bf.has_unlimited_access
      OR EXISTS (
        SELECT 1 FROM account_song_unlock asu
        WHERE asu.account_id = p_account_id
          AND asu.song_id = ls.song_id
          AND asu.revoked_at IS NULL
      )
    )
  GROUP BY s.release_year
  ORDER BY s.release_year ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_account_release_year_counts(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_account_release_year_counts(UUID)
  TO service_role;
