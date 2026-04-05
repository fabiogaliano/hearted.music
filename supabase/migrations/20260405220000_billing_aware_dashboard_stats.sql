-- S3-09: Billing-aware dashboard stats
-- Replaces count_analyzed_songs_for_account with entitlement-gated version.
-- Entitled = active unlock row OR unlimited access (subscription active OR self_hosted).

CREATE OR REPLACE FUNCTION count_analyzed_songs_for_account(p_account_id UUID)
RETURNS BIGINT
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
  SELECT COUNT(DISTINCT ls.song_id)
  FROM liked_song ls
  CROSS JOIN billing_facts bf
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL
    -- Must have analysis
    AND EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
    -- Must be entitled
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
