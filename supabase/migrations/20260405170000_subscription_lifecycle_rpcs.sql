-- Subscription Lifecycle RPCs
-- S1-07: activate_subscription, deactivate_subscription, update_subscription_state
-- Depends on: billing_core_tables (S1-01), reprioritize_pending_jobs_rpc (S1-10)

CREATE OR REPLACE FUNCTION activate_subscription(
  p_account_id              UUID,
  p_plan                    TEXT,
  p_stripe_subscription_id  TEXT,
  p_stripe_customer_id      TEXT,
  p_subscription_period_end TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE account_billing
  SET
    plan                    = p_plan,
    stripe_subscription_id  = p_stripe_subscription_id,
    stripe_customer_id      = p_stripe_customer_id,
    subscription_status     = 'active',
    subscription_period_end = p_subscription_period_end,
    unlimited_access_source = 'subscription',
    cancel_at_period_end    = FALSE
  WHERE account_id = p_account_id;

  PERFORM reprioritize_pending_jobs_for_account(p_account_id);
END;
$$;

CREATE OR REPLACE FUNCTION deactivate_subscription(
  p_account_id UUID
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE account_billing
  SET
    plan                    = 'free',
    unlimited_access_source = CASE
                                WHEN unlimited_access_source = 'subscription' THEN NULL
                                ELSE unlimited_access_source
                              END
  WHERE account_id = p_account_id;

  PERFORM reprioritize_pending_jobs_for_account(p_account_id);
END;
$$;

CREATE OR REPLACE FUNCTION update_subscription_state(
  p_account_id              UUID,
  p_subscription_status     TEXT,
  p_subscription_period_end TIMESTAMPTZ,
  p_cancel_at_period_end    BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE account_billing
  SET
    subscription_status     = p_subscription_status,
    subscription_period_end = p_subscription_period_end,
    cancel_at_period_end    = p_cancel_at_period_end
  WHERE account_id = p_account_id;

  PERFORM reprioritize_pending_jobs_for_account(p_account_id);
END;
$$;
