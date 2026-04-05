-- Credit & Pack RPCs
-- S1-06: grant_credits, fulfill_pack_purchase, reverse_pack_entitlement
-- Depends on: billing_core_tables (S1-01), billing_pack_conversion_tables (S1-02),
--             core_unlock_rpcs (S1-05), reprioritize_pending_jobs_rpc (S1-10)

-- grant_credits: operational/replacement credit grant without creating pack lot value
CREATE OR REPLACE FUNCTION grant_credits(
  p_account_id      UUID,
  p_amount          INTEGER,
  p_reason          TEXT,
  p_stripe_event_id TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF p_reason NOT IN ('replacement_grant', 'admin_adjustment') THEN
    RAISE EXCEPTION 'grant_credits: invalid reason ''%'' (must be replacement_grant or admin_adjustment)',
      p_reason;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'grant_credits: amount must be positive, got %', p_amount;
  END IF;

  SELECT ab.credit_balance INTO v_balance
  FROM account_billing ab
  WHERE ab.account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant_credits: account_billing not found for account %', p_account_id;
  END IF;

  UPDATE account_billing
  SET credit_balance = credit_balance + p_amount
  WHERE account_id = p_account_id;

  INSERT INTO credit_transaction (account_id, amount, balance_after, reason, stripe_event_id)
  VALUES (p_account_id, p_amount, v_balance + p_amount, p_reason, p_stripe_event_id);

  RETURN v_balance + p_amount;
END;
$$;

-- fulfill_pack_purchase: idempotent pack fulfillment with bonus unlocks
CREATE OR REPLACE FUNCTION fulfill_pack_purchase(
  p_account_id      UUID,
  p_stripe_event_id TEXT,
  p_offer_id        TEXT,
  p_credits         INTEGER,
  p_price_cents     INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance          INTEGER;
  v_bonus_candidates UUID[];
  v_bonus_ids        UUID[];
BEGIN
  -- Idempotency gate: ON CONFLICT DO NOTHING on pack_credit_lot.stripe_event_id UNIQUE
  INSERT INTO pack_credit_lot (
    account_id, stripe_event_id, offer_id, original_credits, remaining_credits, price_cents
  ) VALUES (
    p_account_id, p_stripe_event_id, p_offer_id, p_credits, p_credits, p_price_cents
  ) ON CONFLICT (stripe_event_id) DO NOTHING;

  IF NOT FOUND THEN
    -- Already fulfilled: return current state without mutations
    SELECT ab.credit_balance INTO v_balance
    FROM account_billing ab
    WHERE ab.account_id = p_account_id;

    SELECT ARRAY(
      SELECT asu.song_id
      FROM account_song_unlock asu
      WHERE asu.account_id = p_account_id
        AND asu.granted_stripe_event_id = p_stripe_event_id
        AND asu.source = 'pack'
    ) INTO v_bonus_ids;

    RETURN jsonb_build_object(
      'new_balance',             v_balance,
      'bonus_unlocked_song_ids', to_jsonb(v_bonus_ids)
    );
  END IF;

  SELECT ab.credit_balance INTO v_balance
  FROM account_billing ab
  WHERE ab.account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fulfill_pack_purchase: account_billing not found for account %', p_account_id;
  END IF;

  UPDATE account_billing
  SET credit_balance = credit_balance + p_credits
  WHERE account_id = p_account_id;

  INSERT INTO credit_transaction (account_id, amount, balance_after, reason, stripe_event_id)
  VALUES (p_account_id, p_credits, v_balance + p_credits, 'pack_purchase', p_stripe_event_id);

  -- Up to 25 bonus candidates: most-recent currently liked songs not already unlocked
  SELECT ARRAY(
    SELECT ls.song_id
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM account_song_unlock asu
        WHERE asu.account_id = p_account_id
          AND asu.song_id = ls.song_id
          AND asu.revoked_at IS NULL
      )
    ORDER BY ls.liked_at DESC
    LIMIT 25
  ) INTO v_bonus_candidates;

  IF cardinality(v_bonus_candidates) > 0 THEN
    SELECT ARRAY(
      SELECT song_id
      FROM insert_song_unlocks_without_charge(
        p_account_id,
        v_bonus_candidates,
        'pack',
        p_stripe_event_id
      )
    ) INTO v_bonus_ids;
  ELSE
    v_bonus_ids := '{}';
  END IF;

  PERFORM reprioritize_pending_jobs_for_account(p_account_id);

  RETURN jsonb_build_object(
    'new_balance',             v_balance + p_credits,
    'bonus_unlocked_song_ids', to_jsonb(v_bonus_ids)
  );
END;
$$;

-- reverse_pack_entitlement: credit subtraction and pack unlock revocation on refund/chargeback
-- NOTE: Idempotency is handled by the billing service at the billing_webhook_event level
-- before calling this RPC. A second call after the lot is zeroed would incorrectly compute
-- credits_spent = original_credits. A future hardening story could add a reversed_at column
-- to pack_credit_lot as an additional in-RPC guard.
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

  -- Lock account_billing first (consistent lock order: account_billing → pack_credit_lot)
  SELECT ab.credit_balance INTO v_balance
  FROM account_billing ab
  WHERE ab.account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_pack_entitlement: account_billing not found for account %',
      p_account_id;
  END IF;

  SELECT pcl.id, pcl.original_credits, pcl.remaining_credits
  INTO v_lot
  FROM pack_credit_lot pcl
  WHERE pcl.account_id = p_account_id
    AND pcl.stripe_event_id = p_pack_stripe_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_pack_entitlement: pack_credit_lot not found for event %',
      p_pack_stripe_event_id;
  END IF;

  v_credits_to_sub := v_lot.remaining_credits;
  v_credits_spent  := v_lot.original_credits - v_lot.remaining_credits;

  UPDATE pack_credit_lot
  SET remaining_credits = 0
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

  -- Revoke bonus unlocks tagged with this pack's stripe_event_id
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

  -- Revoke credits_spent newest active source='pack' unlocks (for balance already spent)
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
