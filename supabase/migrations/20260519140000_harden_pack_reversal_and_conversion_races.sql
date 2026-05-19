-- Billing hardening (Part 2 of split plan): make reverse_pack_entitlement
-- idempotent at the SQL layer and remove the check-then-insert race in
-- prepare_subscription_upgrade_conversion.
--
-- See claudedocs/billing-hardening-plan-2026-05/02-db-race-hardening.md
-- for the design rationale.

-- 1. Add a reversal sentinel to pack_credit_lot so the RPC can early-return
--    instead of relying on the billing-service idempotency layer alone.
ALTER TABLE pack_credit_lot
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

-- 2. Harden reverse_pack_entitlement: second execution is a no-op.
--
-- Lock order preserved: account_billing -> pack_credit_lot. The reversed_at
-- gate must run *after* acquiring the FOR UPDATE lock on the lot, otherwise
-- two concurrent callers could both observe reversed_at IS NULL.
CREATE OR REPLACE FUNCTION reverse_pack_entitlement(
  p_account_id           UUID,
  p_pack_stripe_event_id TEXT,
  p_stripe_event_id      TEXT,
  p_reason               TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot            RECORD;
  v_balance        INTEGER;
  v_credits_to_sub INTEGER;
  v_credits_spent  INTEGER;
  v_txn_reason     TEXT;
  v_revoke_reason  TEXT;
  v_bonus_revoked  UUID[];
  v_extra_revoked  UUID[];
BEGIN
  IF p_reason = 'refund' THEN
    v_txn_reason    := 'refund';
    v_revoke_reason := 'refund';
  ELSIF p_reason = 'chargeback' THEN
    v_txn_reason    := 'chargeback_reversal';
    v_revoke_reason := 'chargeback';
  ELSE
    RAISE EXCEPTION 'reverse_pack_entitlement: invalid reason ''%'' (must be refund or chargeback)',
      p_reason;
  END IF;

  SELECT ab.credit_balance INTO v_balance
  FROM account_billing ab
  WHERE ab.account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_pack_entitlement: account_billing not found for account %',
      p_account_id;
  END IF;

  SELECT pcl.id, pcl.original_credits, pcl.remaining_credits, pcl.reversed_at
  INTO v_lot
  FROM pack_credit_lot pcl
  WHERE pcl.account_id = p_account_id
    AND pcl.stripe_event_id = p_pack_stripe_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_pack_entitlement: pack_credit_lot not found for event %',
      p_pack_stripe_event_id;
  END IF;

  -- Idempotency gate: a previously-reversed lot must not be touched again.
  -- Returning zero changes keeps the caller contract intact without writing
  -- a second credit_transaction or revoking unrelated unlocks.
  IF v_lot.reversed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'credits_reversed', 0,
      'revoked_song_ids', '[]'::jsonb
    );
  END IF;

  v_credits_to_sub := v_lot.remaining_credits;
  v_credits_spent  := v_lot.original_credits - v_lot.remaining_credits;

  UPDATE pack_credit_lot
  SET remaining_credits = 0,
      reversed_at       = now()
  WHERE id = v_lot.id;

  UPDATE account_billing
  SET credit_balance = credit_balance - v_credits_to_sub
  WHERE account_id = p_account_id;

  INSERT INTO credit_transaction (
    account_id, amount, balance_after, reason, stripe_event_id, metadata
  ) VALUES (
    p_account_id,
    -v_credits_to_sub,
    v_balance - v_credits_to_sub,
    v_txn_reason,
    p_stripe_event_id,
    jsonb_build_object('pack_stripe_event_id', p_pack_stripe_event_id)
  );

  WITH bonus_revoke AS (
    UPDATE account_song_unlock
    SET revoked_at              = now(),
        revoked_reason          = v_revoke_reason,
        revoked_stripe_event_id = p_stripe_event_id
    WHERE account_id = p_account_id
      AND granted_stripe_event_id = p_pack_stripe_event_id
      AND source = 'pack'
      AND revoked_at IS NULL
    RETURNING song_id
  )
  SELECT ARRAY(SELECT song_id FROM bonus_revoke) INTO v_bonus_revoked;

  IF v_credits_spent > 0 THEN
    WITH extra_candidates AS (
      SELECT id
      FROM account_song_unlock
      WHERE account_id = p_account_id
        AND source = 'pack'
        AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT v_credits_spent
    ),
    extra_revoke AS (
      UPDATE account_song_unlock
      SET revoked_at              = now(),
          revoked_reason          = v_revoke_reason,
          revoked_stripe_event_id = p_stripe_event_id
      WHERE id IN (SELECT id FROM extra_candidates)
      RETURNING song_id
    )
    SELECT ARRAY(SELECT song_id FROM extra_revoke) INTO v_extra_revoked;
  ELSE
    v_extra_revoked := '{}';
  END IF;

  PERFORM reprioritize_pending_jobs_for_account(p_account_id);

  RETURN jsonb_build_object(
    'credits_reversed', v_credits_to_sub,
    'revoked_song_ids', to_jsonb(v_bonus_revoked || v_extra_revoked)
  );
END;
$$;

-- 3. Make prepare_subscription_upgrade_conversion race-safe.
--
-- The partial unique index idx_subscription_credit_conversion_pending_per_account
-- guarantees at most one pending row per account. Two concurrent callers that
-- both miss the fast-path SELECT race on the INSERT. Postgres waits on the
-- index, so by the time the loser catches unique_violation the winning row is
-- committed and visible. Re-selecting it returns the canonical conversion to
-- the caller without surfacing a 500.
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
  v_insert_won        BOOLEAN := FALSE;
BEGIN
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

  BEGIN
    INSERT INTO subscription_credit_conversion (
      account_id, target_plan, status, converted_credits, discount_cents
    ) VALUES (
      p_account_id, p_target_plan, 'pending', 0, 0
    )
    RETURNING id INTO v_conversion_id;

    v_insert_won := TRUE;
  EXCEPTION
    WHEN unique_violation THEN
      -- The concurrent winner has committed the pending row by the time
      -- Postgres releases this transaction from the index wait. Re-select
      -- it with FOR UPDATE and return its canonical totals.
      SELECT scc.id, scc.converted_credits, scc.discount_cents
      INTO v_conversion_id, v_converted_credits, v_discount_cents
      FROM subscription_credit_conversion scc
      WHERE scc.account_id = p_account_id
        AND scc.status = 'pending'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'prepare_subscription_upgrade_conversion: unique_violation but no pending row found for account %',
          p_account_id;
      END IF;
  END;

  IF NOT v_insert_won THEN
    RETURN QUERY SELECT v_converted_credits, v_discount_cents, v_conversion_id;
    RETURN;
  END IF;

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
