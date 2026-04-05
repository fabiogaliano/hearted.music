CREATE OR REPLACE FUNCTION reverse_unlimited_period_entitlement(
  p_stripe_subscription_id TEXT,
  p_subscription_period_end TIMESTAMPTZ,
  p_stripe_event_id TEXT,
  p_revoked_reason TEXT
) RETURNS TABLE(song_id UUID)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH revoked_rows AS (
    UPDATE account_song_unlock
    SET 
      revoked_at = now(),
      revoked_reason = p_revoked_reason,
      revoked_stripe_event_id = p_stripe_event_id
    WHERE 
      source = 'unlimited'
      AND granted_stripe_subscription_id = p_stripe_subscription_id
      AND granted_subscription_period_end = p_subscription_period_end
      AND revoked_at IS NULL  -- Idempotency: skip already-revoked rows
    RETURNING song_id
  )
  SELECT song_id FROM revoked_rows;
$$;

-- Test cases (for manual verification):
-- 
-- Should revoke and return song IDs:
-- 1. Active unlimited unlock rows matching (p_stripe_subscription_id, p_subscription_period_end)
-- 
-- Should NOT affect:
-- 2. source='free_auto', 'pack', 'self_hosted', or 'admin' unlock rows
-- 3. unlimited unlock rows with different subscription IDs or period ends
-- 4. Already revoked unlimited unlock rows (revoked_at IS NOT NULL) - idempotent
-- 
-- Should return empty set:
-- 5. When all matching rows are already revoked
-- 6. When no rows match the reversal key