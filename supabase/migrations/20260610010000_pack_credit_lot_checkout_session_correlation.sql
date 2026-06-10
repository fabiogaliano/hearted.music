-- Correlate a pack_credit_lot with the Stripe Checkout Session that created it,
-- so a refund/chargeback reverses the SPECIFIC lot the refunded charge paid for
-- rather than the most-recently-created lot for the account.
--
-- Before this, the billing service resolved the lot to reverse with
-- `ORDER BY created_at DESC LIMIT 1`. For an account with two or more packs,
-- refunding an older pack reversed the newest lot instead. The checkout session
-- id is the stable 1:1 key shared by both the fulfillment path (the session that
-- produced checkout.session.completed) and the refund path (charge -> payment_intent
-- -> checkout session), so storing it lets the reversal target the correct lot.

ALTER TABLE pack_credit_lot
  ADD COLUMN IF NOT EXISTS checkout_session_id TEXT;

-- One checkout session produces exactly one fulfillment, hence one lot. The
-- partial predicate keeps legacy rows (NULL session id) from colliding.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_credit_lot_checkout_session
  ON pack_credit_lot(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

-- Replace fulfill_pack_purchase with a 6-arg signature that persists the
-- checkout session id at lot-insert time. Adding a parameter changes the
-- function signature, so the old overload is dropped first to avoid leaving two
-- resolvable variants. EXECUTE grants are re-applied for the new signature.
DROP FUNCTION IF EXISTS fulfill_pack_purchase(UUID, TEXT, TEXT, INTEGER, INTEGER);

CREATE FUNCTION fulfill_pack_purchase(
  p_account_id          UUID,
  p_stripe_event_id     TEXT,
  p_offer_id            TEXT,
  p_credits             INTEGER,
  p_price_cents         INTEGER,
  p_checkout_session_id TEXT DEFAULT NULL
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
    account_id, stripe_event_id, offer_id, original_credits, remaining_credits,
    price_cents, checkout_session_id
  ) VALUES (
    p_account_id, p_stripe_event_id, p_offer_id, p_credits, p_credits,
    p_price_cents, p_checkout_session_id
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

-- Preprod posture (mirrors 20260519110000_harden_internal_rpcs): the RPC is
-- backend-private and only reachable through the service-role client.
REVOKE EXECUTE ON FUNCTION
  public.fulfill_pack_purchase(UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.fulfill_pack_purchase(UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT)
TO service_role;
