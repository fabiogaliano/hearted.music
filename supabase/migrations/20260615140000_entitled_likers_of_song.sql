-- Find every account that currently likes a song AND is entitled to it
-- (unlimited access or an active per-song unlock). Used by the audio-feature
-- backfill worker to wake enrichment for all affected accounts when a job
-- settles — the feature row is song-level shared data, so it's not only the
-- requesting account that should re-run analysis.
--
-- This is the inverse of is_account_song_entitled / the selector's entitlement
-- predicate, applied across all likers of one song.

CREATE OR REPLACE FUNCTION get_entitled_likers_of_song(p_song_id UUID)
RETURNS TABLE(account_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ls.account_id
  FROM liked_song ls
  WHERE ls.song_id = p_song_id
    AND ls.unliked_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM account_song_unlock asu
        WHERE asu.account_id = ls.account_id
          AND asu.song_id = ls.song_id
          AND asu.revoked_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM account_billing ab
        WHERE ab.account_id = ls.account_id
          AND ab.unlimited_access_source IS NOT NULL
          AND (
            ab.unlimited_access_source = 'self_hosted'
            OR (
              ab.unlimited_access_source = 'subscription'
              AND ab.subscription_status = 'active'
            )
          )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION get_entitled_likers_of_song(UUID) TO service_role;
