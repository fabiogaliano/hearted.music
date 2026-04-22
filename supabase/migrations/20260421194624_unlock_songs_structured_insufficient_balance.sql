-- Replace unlock_songs_for_account to return a discriminated JSONB payload.
-- Recoverable outcomes (success, insufficient balance) become structured
-- results with a `status` field; invariant violations and invalid ownership
-- continue to raise exceptions. This removes exception-string parsing in the
-- TypeScript orchestration layer.

CREATE OR REPLACE FUNCTION unlock_songs_for_account(
  p_account_id UUID,
  p_song_ids   UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deduped    UUID[];
  v_already    UUID[];
  v_net_new    UUID[];
  v_cost       INTEGER;
  v_reserved   INTEGER;
  v_balance    INTEGER;
  v_spendable  INTEGER;
  v_op_balance INTEGER;
  v_remaining  INTEGER;
  v_lot        RECORD;
  v_lot_deduct INTEGER;
BEGIN
  IF cardinality(p_song_ids) > 500 THEN
    RAISE EXCEPTION 'unlock_songs_for_account: input cap exceeded (max 500, got %)',
      cardinality(p_song_ids);
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_song_ids)) INTO v_deduped;

  IF EXISTS (
    SELECT 1 FROM unnest(v_deduped) AS s(song_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM liked_song ls
      WHERE ls.account_id = p_account_id
        AND ls.song_id = s.song_id
        AND ls.unliked_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'unlock_songs_for_account: one or more songs not currently liked by account %',
      p_account_id;
  END IF;

  SELECT ARRAY(
    SELECT asu.song_id
    FROM account_song_unlock asu
    WHERE asu.account_id = p_account_id
      AND asu.song_id = ANY(v_deduped)
      AND asu.revoked_at IS NULL
  ) INTO v_already;

  SELECT ARRAY(
    SELECT s FROM unnest(v_deduped) AS s
    WHERE s <> ALL(v_already)
  ) INTO v_net_new;

  v_cost := cardinality(v_net_new);

  IF v_cost = 0 THEN
    RETURN jsonb_build_object(
      'status',                    'ok',
      'newly_unlocked_song_ids',   '[]'::JSONB,
      'already_unlocked_song_ids', to_jsonb(v_already)
    );
  END IF;

  SELECT ab.credit_balance INTO v_balance
  FROM account_billing ab
  WHERE ab.account_id = p_account_id
  FOR UPDATE;

  SELECT COALESCE(SUM(scca.reserved_credits), 0) INTO v_reserved
  FROM subscription_credit_conversion_allocation scca
  JOIN subscription_credit_conversion scc ON scca.conversion_id = scc.id
  WHERE scc.account_id = p_account_id
    AND scc.status = 'pending';

  v_spendable := GREATEST(v_balance - v_reserved, 0);

  -- Recoverable outcome: return structured payload instead of raising so the
  -- caller does not need to parse exception strings.
  IF v_spendable < v_cost THEN
    RETURN jsonb_build_object(
      'status',            'insufficient_balance',
      'required_credits',  v_cost,
      'available_credits', v_spendable
    );
  END IF;

  SELECT GREATEST(v_balance - COALESCE(SUM(pcl.remaining_credits), 0), 0) INTO v_op_balance
  FROM pack_credit_lot pcl
  WHERE pcl.account_id = p_account_id;

  v_remaining := v_cost;

  IF v_op_balance > 0 AND v_remaining > 0 THEN
    v_remaining := v_remaining - LEAST(v_op_balance, v_remaining);
  END IF;

  IF v_remaining > 0 THEN
    FOR v_lot IN
      SELECT id, remaining_credits
      FROM pack_credit_lot
      WHERE account_id = p_account_id AND remaining_credits > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining = 0;
      v_lot_deduct := LEAST(v_lot.remaining_credits, v_remaining);
      UPDATE pack_credit_lot
      SET remaining_credits = remaining_credits - v_lot_deduct
      WHERE id = v_lot.id;
      v_remaining := v_remaining - v_lot_deduct;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'unlock_songs_for_account: lot deduction underflow (undeducted=%) — balance invariant violated',
        v_remaining;
    END IF;
  END IF;

  UPDATE account_billing
  SET credit_balance = credit_balance - v_cost
  WHERE account_id = p_account_id;

  INSERT INTO credit_transaction (account_id, amount, balance_after, reason, metadata)
  VALUES (
    p_account_id,
    -v_cost,
    v_balance - v_cost,
    'song_unlock',
    jsonb_build_object('song_count', v_cost)
  );

  INSERT INTO account_song_unlock (account_id, song_id, source)
  SELECT p_account_id, s, 'pack'
  FROM unnest(v_net_new) AS s
  ON CONFLICT (account_id, song_id) DO UPDATE
    SET source                  = 'pack',
        revoked_at              = NULL,
        revoked_reason          = NULL,
        revoked_stripe_event_id = NULL
    WHERE account_song_unlock.revoked_at IS NOT NULL;

  RETURN jsonb_build_object(
    'status',                    'ok',
    'newly_unlocked_song_ids',   to_jsonb(v_net_new),
    'already_unlocked_song_ids', to_jsonb(v_already)
  );
END;
$$;
