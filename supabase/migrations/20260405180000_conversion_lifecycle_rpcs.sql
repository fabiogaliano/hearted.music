-- Conversion Lifecycle RPCs
-- S1-08: prepare, link, release, apply, reverse for pack-to-unlimited upgrade conversion
-- Depends on: billing_core_tables (S1-01), billing_pack_conversion_tables (S1-02)

CREATE OR REPLACE FUNCTION prepare_subscription_upgrade_conversion(
  p_account_id UUID,
  p_target_plan TEXT
) RETURNS TABLE(converted_credits INTEGER, discount_cents INTEGER, conversion_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversion_id     UUID;
  v_converted_credits INTEGER;
  v_discount_cents    INTEGER;
  v_lot               RECORD;
  v_lot_discount      INTEGER;
BEGIN
  -- Check for existing pending conversion (reuse if present)
  SELECT scc.id, scc.converted_credits, scc.discount_cents
  INTO v_conversion_id, v_converted_credits, v_discount_cents
  FROM subscription_credit_conversion scc
  WHERE scc.account_id = p_account_id
    AND scc.status = 'pending'
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT v_converted_credits, v_discount_cents, v_conversion_id;
    RETURN;
  END IF;

  v_converted_credits := 0;
  v_discount_cents    := 0;

  INSERT INTO subscription_credit_conversion (
    account_id, target_plan, status, converted_credits, discount_cents
  ) VALUES (
    p_account_id, p_target_plan, 'pending', 0, 0
  )
  RETURNING id INTO v_conversion_id;

  -- Lock open lots FIFO and create allocation rows
  FOR v_lot IN
    SELECT id, remaining_credits, original_credits, price_cents
    FROM pack_credit_lot
    WHERE account_id = p_account_id
      AND remaining_credits > 0
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    v_lot_discount := (v_lot.remaining_credits * v_lot.price_cents) / v_lot.original_credits;

    INSERT INTO subscription_credit_conversion_allocation (
      conversion_id, pack_credit_lot_id, reserved_credits, reserved_discount_cents
    ) VALUES (
      v_conversion_id, v_lot.id, v_lot.remaining_credits, v_lot_discount
    );

    v_converted_credits := v_converted_credits + v_lot.remaining_credits;
    v_discount_cents    := v_discount_cents    + v_lot_discount;
  END LOOP;

  UPDATE subscription_credit_conversion
  SET converted_credits = v_converted_credits,
      discount_cents    = v_discount_cents
  WHERE id = v_conversion_id;

  RETURN QUERY SELECT v_converted_credits, v_discount_cents, v_conversion_id;
END;
$$;


CREATE OR REPLACE FUNCTION link_subscription_upgrade_checkout(
  p_conversion_id       UUID,
  p_checkout_session_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE subscription_credit_conversion
  SET checkout_session_id = p_checkout_session_id
  WHERE id = p_conversion_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_subscription_upgrade_checkout: conversion % not found or not pending',
      p_conversion_id;
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION release_subscription_upgrade_conversion(
  p_conversion_id UUID
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM id
  FROM subscription_credit_conversion
  WHERE id = p_conversion_id
  FOR UPDATE;

  UPDATE subscription_credit_conversion
  SET status = 'released'
  WHERE id = p_conversion_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_subscription_upgrade_conversion: conversion % not found or not pending',
      p_conversion_id;
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION apply_subscription_upgrade_conversion(
  p_conversion_id          UUID,
  p_stripe_subscription_id TEXT,
  p_stripe_invoice_id      TEXT,
  p_applied_stripe_event_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id        UUID;
  v_converted_credits INTEGER;
  v_balance           INTEGER;
  v_alloc             RECORD;
BEGIN
  SELECT scc.account_id, scc.converted_credits
  INTO v_account_id, v_converted_credits
  FROM subscription_credit_conversion scc
  WHERE scc.id = p_conversion_id
    AND scc.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_subscription_upgrade_conversion: conversion % not found or not pending',
      p_conversion_id;
  END IF;

  SELECT ab.credit_balance INTO v_balance
  FROM account_billing ab
  WHERE ab.account_id = v_account_id
  FOR UPDATE;

  -- Consume reserved credits from each lot
  FOR v_alloc IN
    SELECT scca.pack_credit_lot_id, scca.reserved_credits
    FROM subscription_credit_conversion_allocation scca
    WHERE scca.conversion_id = p_conversion_id
    ORDER BY scca.pack_credit_lot_id
    FOR UPDATE
  LOOP
    UPDATE pack_credit_lot
    SET remaining_credits = remaining_credits - v_alloc.reserved_credits
    WHERE id = v_alloc.pack_credit_lot_id;
  END LOOP;

  UPDATE account_billing
  SET credit_balance = credit_balance - v_converted_credits
  WHERE account_id = v_account_id;

  INSERT INTO credit_transaction (
    account_id, amount, balance_after, reason, stripe_event_id, metadata
  ) VALUES (
    v_account_id,
    -v_converted_credits,
    v_balance - v_converted_credits,
    'credit_conversion',
    p_applied_stripe_event_id,
    jsonb_build_object('conversion_id', p_conversion_id)
  );

  UPDATE subscription_credit_conversion
  SET status                  = 'applied',
      stripe_subscription_id  = p_stripe_subscription_id,
      stripe_invoice_id       = p_stripe_invoice_id,
      applied_stripe_event_id = p_applied_stripe_event_id
  WHERE id = p_conversion_id;
END;
$$;


CREATE OR REPLACE FUNCTION reverse_subscription_upgrade_conversion(
  p_conversion_id   UUID,
  p_stripe_event_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id        UUID;
  v_converted_credits INTEGER;
  v_balance           INTEGER;
  v_alloc             RECORD;
BEGIN
  SELECT scc.account_id, scc.converted_credits
  INTO v_account_id, v_converted_credits
  FROM subscription_credit_conversion scc
  WHERE scc.id = p_conversion_id
    AND scc.status = 'applied'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_subscription_upgrade_conversion: conversion % not found or not applied',
      p_conversion_id;
  END IF;

  SELECT ab.credit_balance INTO v_balance
  FROM account_billing ab
  WHERE ab.account_id = v_account_id
  FOR UPDATE;

  -- Restore exact allocated lot amounts
  FOR v_alloc IN
    SELECT scca.pack_credit_lot_id, scca.reserved_credits
    FROM subscription_credit_conversion_allocation scca
    WHERE scca.conversion_id = p_conversion_id
    ORDER BY scca.pack_credit_lot_id
    FOR UPDATE
  LOOP
    UPDATE pack_credit_lot
    SET remaining_credits = remaining_credits + v_alloc.reserved_credits
    WHERE id = v_alloc.pack_credit_lot_id;
  END LOOP;

  UPDATE account_billing
  SET credit_balance = credit_balance + v_converted_credits
  WHERE account_id = v_account_id;

  INSERT INTO credit_transaction (
    account_id, amount, balance_after, reason, stripe_event_id, metadata
  ) VALUES (
    v_account_id,
    v_converted_credits,
    v_balance + v_converted_credits,
    'credit_conversion_reversal',
    p_stripe_event_id,
    jsonb_build_object('conversion_id', p_conversion_id)
  );

  UPDATE subscription_credit_conversion
  SET status = 'reversed'
  WHERE id = p_conversion_id;
END;
$$;
