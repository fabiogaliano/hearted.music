-- Subscription lifecycle hardening: reject stale state writes based on the
-- originating Stripe event timestamp.
--
-- A separate SELECT ... FOR UPDATE would not fix the real issue here: an older
-- Stripe event can still arrive after a newer one and overwrite the canonical
-- lifecycle state. We instead persist the latest processed event timestamp and
-- only apply mutations from events that are at least as new.
--
-- Equal-second events are still allowed because Stripe event.created is only
-- second-resolution. Brand-side handlers now resolve current subscription
-- state from Stripe before calling these RPCs, so same-second replays converge
-- on the latest remote state instead of stale payload snapshots.

ALTER TABLE account_billing
  ADD COLUMN IF NOT EXISTS last_subscription_state_event_created_at TIMESTAMPTZ;

DROP FUNCTION IF EXISTS activate_subscription(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION activate_subscription(
  p_account_id              UUID,
  p_plan                    TEXT,
  p_stripe_subscription_id  TEXT,
  p_stripe_customer_id      TEXT,
  p_subscription_period_end TIMESTAMPTZ,
  p_stripe_event_created_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_stripe_event_created_at IS NULL THEN
    RAISE EXCEPTION 'activate_subscription: p_stripe_event_created_at is required';
  END IF;

  UPDATE account_billing
  SET
    plan                                     = p_plan,
    stripe_subscription_id                   = p_stripe_subscription_id,
    stripe_customer_id                       = p_stripe_customer_id,
    subscription_status                      = 'active',
    subscription_period_end                  = p_subscription_period_end,
    unlimited_access_source                  = 'subscription',
    cancel_at_period_end                     = FALSE,
    last_subscription_state_event_created_at = p_stripe_event_created_at
  WHERE account_id = p_account_id
    AND (
      last_subscription_state_event_created_at IS NULL
      OR p_stripe_event_created_at >= last_subscription_state_event_created_at
    );

  IF FOUND THEN
    PERFORM reprioritize_pending_jobs_for_account(p_account_id);
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS deactivate_subscription(UUID);
CREATE OR REPLACE FUNCTION deactivate_subscription(
  p_account_id UUID,
  p_stripe_event_created_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_stripe_event_created_at IS NULL THEN
    RAISE EXCEPTION 'deactivate_subscription: p_stripe_event_created_at is required';
  END IF;

  UPDATE account_billing
  SET
    plan                                     = 'free',
    unlimited_access_source                  = CASE
                                                WHEN unlimited_access_source = 'subscription' THEN NULL
                                                ELSE unlimited_access_source
                                              END,
    last_subscription_state_event_created_at = p_stripe_event_created_at
  WHERE account_id = p_account_id
    AND (
      last_subscription_state_event_created_at IS NULL
      OR p_stripe_event_created_at >= last_subscription_state_event_created_at
    );

  IF FOUND THEN
    PERFORM reprioritize_pending_jobs_for_account(p_account_id);
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS update_subscription_state(UUID, TEXT, TIMESTAMPTZ, BOOLEAN);
CREATE OR REPLACE FUNCTION update_subscription_state(
  p_account_id              UUID,
  p_subscription_status     TEXT,
  p_subscription_period_end TIMESTAMPTZ,
  p_cancel_at_period_end    BOOLEAN,
  p_stripe_event_created_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_stripe_event_created_at IS NULL THEN
    RAISE EXCEPTION 'update_subscription_state: p_stripe_event_created_at is required';
  END IF;

  UPDATE account_billing
  SET
    subscription_status                      = p_subscription_status,
    subscription_period_end                  = p_subscription_period_end,
    cancel_at_period_end                     = p_cancel_at_period_end,
    last_subscription_state_event_created_at = p_stripe_event_created_at
  WHERE account_id = p_account_id
    AND (
      last_subscription_state_event_created_at IS NULL
      OR p_stripe_event_created_at >= last_subscription_state_event_created_at
    );

  IF FOUND THEN
    PERFORM reprioritize_pending_jobs_for_account(p_account_id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION activate_subscription(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION deactivate_subscription(UUID, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION update_subscription_state(UUID, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION activate_subscription(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
TO service_role;
GRANT EXECUTE ON FUNCTION deactivate_subscription(UUID, TIMESTAMPTZ)
TO service_role;
GRANT EXECUTE ON FUNCTION update_subscription_state(UUID, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ)
TO service_role;
