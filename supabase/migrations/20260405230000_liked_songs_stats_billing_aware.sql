-- S3-08: Billing-aware liked songs stats with locked count
-- Depends on: S1-04 (entitlement predicate), S3-07 (billing_facts CTE pattern)
--
-- Updates get_liked_songs_stats to:
-- 1. Add `locked` count for non-entitled songs
-- 2. Gate `pending` to entitled songs only (excludes locked)
-- 3. Gate `analyzed` to entitled songs only
-- 4. Gate match-related counts to entitled songs only

DROP FUNCTION IF EXISTS get_liked_songs_stats(UUID);

CREATE OR REPLACE FUNCTION get_liked_songs_stats(p_account_id UUID)
RETURNS TABLE (
  total           BIGINT,
  analyzed        BIGINT,
  matched         BIGINT,
  has_suggestions BIGINT,
  new_suggestions BIGINT,
  pending         BIGINT,
  locked          BIGINT
) AS $$
DECLARE
  v_latest_snapshot_id UUID;
BEGIN
  SELECT ms.id INTO v_latest_snapshot_id
  FROM match_snapshot ms
  WHERE ms.account_id = p_account_id
  ORDER BY ms.created_at DESC
  LIMIT 1;

  RETURN QUERY
  WITH billing_facts AS (
    SELECT COALESCE(
      (
        SELECT
          ab.unlimited_access_source IS NOT NULL
          AND (
            ab.unlimited_access_source = 'self_hosted'
            OR (
              ab.unlimited_access_source = 'subscription'
              AND ab.subscription_status = 'active'
            )
          )
        FROM account_billing ab
        WHERE ab.account_id = p_account_id
      ),
      false
    ) AS has_unlimited_access
  ),
  entitled_songs AS (
    SELECT
      ls2.song_id,
      (
        bf.has_unlimited_access
        OR EXISTS (
          SELECT 1 FROM account_song_unlock asu
          WHERE asu.account_id = p_account_id
            AND asu.song_id = ls2.song_id
            AND asu.revoked_at IS NULL
        )
      ) AS is_entitled
    FROM liked_song ls2
    CROSS JOIN billing_facts bf
    WHERE ls2.account_id = p_account_id
      AND ls2.unliked_at IS NULL
  )
  SELECT
    COUNT(*)::BIGINT,

    -- analyzed: entitled songs with song_analysis
    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id
    ))::BIGINT,

    -- matched: entitled songs where all match_results have decisions
    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
    ) AND NOT EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    ))::BIGINT,

    -- has_suggestions: entitled songs with at least one undecided match_result
    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    ))::BIGINT,

    -- new_suggestions: entitled songs with undecided match_result AND is_new
    COUNT(*) FILTER (WHERE ent.is_entitled AND EXISTS (
      SELECT 1 FROM match_result mr
      WHERE mr.snapshot_id = v_latest_snapshot_id AND mr.song_id = ls.song_id
        AND NOT EXISTS (
          SELECT 1 FROM match_decision md
          WHERE md.account_id = p_account_id
            AND md.song_id = mr.song_id
            AND md.playlist_id = mr.playlist_id
        )
    ) AND EXISTS (
      SELECT 1 FROM item_status ist
      WHERE ist.item_id = ls.song_id
        AND ist.account_id = ls.account_id
        AND ist.item_type = 'song'
        AND ist.is_new = true
    ))::BIGINT,

    -- pending: entitled songs with no item_status row
    COUNT(*) FILTER (WHERE ent.is_entitled AND NOT EXISTS (
      SELECT 1 FROM item_status ist
      WHERE ist.item_id = ls.song_id
        AND ist.account_id = ls.account_id
        AND ist.item_type = 'song'
    ))::BIGINT,

    -- locked: non-entitled songs
    COUNT(*) FILTER (WHERE NOT ent.is_entitled)::BIGINT

  FROM liked_song ls
  JOIN entitled_songs ent ON ent.song_id = ls.song_id
  WHERE ls.account_id = p_account_id
    AND ls.unliked_at IS NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
