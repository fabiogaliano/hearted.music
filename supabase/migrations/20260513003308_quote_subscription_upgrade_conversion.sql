-- Read-only quote for pack-to-unlimited upgrade discounts.
-- Mirrors prepare_subscription_upgrade_conversion discount math without reserving credits.

CREATE OR REPLACE FUNCTION quote_subscription_upgrade_conversion(
  p_account_id UUID
) RETURNS TABLE(converted_credits INTEGER, discount_cents INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending RECORD;
BEGIN
  SELECT scc.converted_credits, scc.discount_cents
  INTO v_pending
  FROM subscription_credit_conversion scc
  WHERE scc.account_id = p_account_id
    AND scc.status = 'pending';

  IF FOUND THEN
    RETURN QUERY SELECT v_pending.converted_credits, v_pending.discount_cents;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(pcl.remaining_credits), 0)::INTEGER AS converted_credits,
    COALESCE(
      SUM((pcl.remaining_credits * pcl.price_cents) / pcl.original_credits),
      0
    )::INTEGER AS discount_cents
  FROM pack_credit_lot pcl
  WHERE pcl.account_id = p_account_id
    AND pcl.remaining_credits > 0;
END;
$$;
