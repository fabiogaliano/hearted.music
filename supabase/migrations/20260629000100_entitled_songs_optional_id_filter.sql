-- Add an optional song-id filter to select_entitled_data_enriched_liked_song_ids.
--
-- The enrichment orchestrator calls this twice per chunk (before/after) only to
-- learn whether any song in the current ~50-song batch became newly matchable,
-- then intersects the result with the batch client-side. Without a filter the
-- RPC computes and ships the account's entire entitled+enriched set (thousands
-- of rows for large libraries) just to answer a question about 50 songs. The new
-- p_song_ids array pushes that filter into the query so it returns at most the
-- batch.
--
-- p_song_ids defaults to NULL = no filter, so the match-snapshot and waitlist
-- candidate-loading callers (which genuinely want the full set) are unchanged.
-- Adding a parameter changes the signature, so the single-arg function is dropped
-- and recreated rather than CREATE OR REPLACEd (which would leave an ambiguous
-- overload). Grants are re-applied to match the prior ACL exactly: EXECUTE for
-- service_role only.

drop function if exists select_entitled_data_enriched_liked_song_ids(uuid);

create function select_entitled_data_enriched_liked_song_ids(
  p_account_id uuid,
  p_song_ids uuid[] default null
)
  returns table(song_id uuid)
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
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

    -- Optional batch filter: NULL means "whole entitled set" (unchanged behavior).
    AND (p_song_ids IS NULL OR ls.song_id = ANY (p_song_ids))

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
$function$;

revoke all on function select_entitled_data_enriched_liked_song_ids(uuid, uuid[]) from public;
grant execute on function select_entitled_data_enriched_liked_song_ids(uuid, uuid[]) to service_role;
