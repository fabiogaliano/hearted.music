-- Make song_audio_feature optional for entitled match-refresh candidate selection.
--
-- Phase A audio_features is a best-effort signal: the matching engine already
-- adapts its weights when audio is missing, so requiring an audio_features row
-- here was blocking otherwise-ready entitled songs from ever entering the
-- candidate pool when the upstream provider had no data.
--
-- Required artifacts after this migration:
--   - song.genres populated
--   - song_analysis row exists
--   - song_embedding row exists
-- Audio (song_audio_feature) is now optional. Entitlement gating is unchanged:
-- effective entitlement is still required (active unlock OR unlimited access).
CREATE OR REPLACE FUNCTION select_entitled_data_enriched_liked_song_ids(
  p_account_id UUID
)
RETURNS TABLE(song_id UUID)
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
  SELECT ls.song_id
  FROM liked_song ls
  CROSS JOIN billing_facts bf
  INNER JOIN song s ON s.id = ls.song_id

  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL

    -- Required artifacts (audio is intentionally optional)
    AND array_length(s.genres, 1) IS NOT NULL
    AND EXISTS (SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id)
    AND EXISTS (SELECT 1 FROM song_embedding se WHERE se.song_id = ls.song_id)

    -- Effective entitlement: active unlock row OR unlimited access
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
