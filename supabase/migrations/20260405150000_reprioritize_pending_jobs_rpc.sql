-- Reprioritize Pending Jobs RPC
-- S1-10: Queue reprioritization function for billing state changes

CREATE OR REPLACE FUNCTION reprioritize_pending_jobs_for_account(
  p_account_id UUID
) RETURNS INTEGER
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH resolved_band AS (
    SELECT 
      CASE
        -- yearly plan with active subscription → priority  
        WHEN ab.plan = 'yearly' 
             AND ab.unlimited_access_source = 'subscription' 
             AND ab.subscription_status = 'active' THEN 2
        -- self_hosted unlimited access → priority
        WHEN ab.unlimited_access_source = 'self_hosted' THEN 2
        -- quarterly plan with active subscription → standard
        WHEN ab.plan = 'quarterly' 
             AND ab.unlimited_access_source = 'subscription' 
             AND ab.subscription_status = 'active' THEN 1
        -- any non-unlimited account with positive credit_balance → standard
        WHEN ab.unlimited_access_source IS NULL 
             AND ab.credit_balance > 0 THEN 1
        -- everything else → low
        ELSE 0
      END AS priority_value
    FROM account_billing ab
    WHERE ab.account_id = p_account_id
  ),
  updated_jobs AS (
    UPDATE job
    SET queue_priority = (SELECT priority_value FROM resolved_band)
    WHERE account_id = p_account_id
      AND type IN ('enrichment', 'match_snapshot_refresh')
      AND status = 'pending'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM updated_jobs;
$$;

-- Test cases (for manual verification):
-- 
-- Should update to priority (2):
-- 1. plan='yearly' + unlimited_access_source='subscription' + subscription_status='active'
-- 2. unlimited_access_source='self_hosted' (any plan, any subscription_status)
-- 
-- Should update to standard (1): 
-- 3. plan='quarterly' + unlimited_access_source='subscription' + subscription_status='active'
-- 4. unlimited_access_source=NULL + credit_balance > 0 (any plan)
-- 
-- Should update to low (0):
-- 5. plan='free' + unlimited_access_source=NULL + credit_balance=0
-- 6. plan='yearly' + unlimited_access_source='subscription' + subscription_status IN ('past_due', 'unpaid', 'canceled')
-- 
-- Should NOT affect:
-- 7. Jobs with status='running' or status='completed' or status='failed'
-- 8. Jobs with type NOT IN ('enrichment', 'match_snapshot_refresh')
-- 9. Jobs for different account_ids
-- 
-- Should return 0:
-- 10. When no pending enrichment/match_snapshot_refresh jobs exist for the account
--
-- Should handle missing account_billing:
-- 11. When no account_billing row exists, default to low (0)