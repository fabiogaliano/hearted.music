-- S1-04: Entitlement Predicate RPC
-- Single canonical function determining whether an account may access a song's paid value

CREATE OR REPLACE FUNCTION is_account_song_entitled(
  p_account_id UUID,
  p_song_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- Case 1: Active unlock row exists
    EXISTS(
      SELECT 1 FROM account_song_unlock
      WHERE account_id = p_account_id
        AND song_id = p_song_id
        AND revoked_at IS NULL
    )
    OR
    -- Case 2: Account has unlimited access
    EXISTS(
      SELECT 1 FROM account_billing
      WHERE account_id = p_account_id
        AND unlimited_access_source IS NOT NULL
        AND (
          unlimited_access_source = 'self_hosted'
          OR (unlimited_access_source = 'subscription' AND subscription_status = 'active')
        )
    )
  );
$$;

-- Test cases (for manual verification):
-- 
-- Should return TRUE:
-- 1. Song with active unlock row: revoked_at IS NULL
-- 2. Song with unlimited_access_source = 'self_hosted' (regardless of subscription_status)
-- 3. Song with unlimited_access_source = 'subscription' AND subscription_status = 'active'
-- 
-- Should return FALSE:
-- 4. Song with revoked unlock row AND no unlimited access
-- 5. Song with unlimited_access_source = 'subscription' AND subscription_status IN ('past_due', 'unpaid', 'canceled', 'none')
-- 6. Song with unlimited_access_source = NULL