-- Per-offer pack bonus unlocks.
--
-- The 250-song pack grants +15 instant bonus unlocks; the new 500-song pack
-- grants +25. The bonus count was hardcoded to 15 inside fulfill_pack_purchase,
-- so this migration threads it through as a parameter (p_bonus_unlocks) the
-- billing service passes per offer. Default stays 15 so existing 6-arg callers
-- (and the 250 pack) keep their current behaviour.
--
-- Adding a parameter changes the function signature, so the old overload is
-- dropped first — otherwise named-arg resolution becomes ambiguous between the
-- 6-arg and 7-arg versions. Everything else is identical to the prior body.

DROP FUNCTION IF EXISTS fulfill_pack_purchase(UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION fulfill_pack_purchase(
  p_account_id          UUID,
  p_stripe_event_id     TEXT,
  p_offer_id            TEXT,
  p_credits             INTEGER,
  p_price_cents         INTEGER,
  p_checkout_session_id TEXT DEFAULT NULL,
  p_bonus_unlocks       INTEGER DEFAULT 15
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance             INTEGER;
  v_active_unlock_count INTEGER;
  v_missing_baseline    INTEGER;
  v_baseline_candidates UUID[];
  v_bonus_candidates    UUID[];
  v_bonus_ids           UUID[];
BEGIN
  INSERT INTO pack_credit_lot (
    account_id, stripe_event_id, offer_id, original_credits, remaining_credits,
    price_cents, checkout_session_id
  ) VALUES (
    p_account_id, p_stripe_event_id, p_offer_id, p_credits, p_credits,
    p_price_cents, p_checkout_session_id
  ) ON CONFLICT (stripe_event_id) DO NOTHING;

  IF NOT FOUND THEN
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

  SELECT COUNT(*)::INTEGER INTO v_active_unlock_count
  FROM account_song_unlock asu
  WHERE asu.account_id = p_account_id
    AND asu.revoked_at IS NULL;

  v_missing_baseline := GREATEST(0, 10 - v_active_unlock_count);

  IF v_missing_baseline > 0 THEN
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
      LIMIT v_missing_baseline
    ) INTO v_baseline_candidates;

    IF COALESCE(cardinality(v_baseline_candidates), 0) > 0 THEN
      PERFORM 1
      FROM insert_song_unlocks_without_charge(
        p_account_id,
        v_baseline_candidates,
        'free_auto'
      );
    END IF;
  END IF;

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
    LIMIT p_bonus_unlocks
  ) INTO v_bonus_candidates;

  IF COALESCE(cardinality(v_bonus_candidates), 0) > 0 THEN
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
