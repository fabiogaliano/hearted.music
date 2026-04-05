-- Core Unlock RPCs: grant per-song access via three distinct paths
-- Depends on: billing_core_tables (S1-01), billing_pack_conversion_tables (S1-02)

-- Function 1: Balance-deducting unlock with FIFO lot consumption
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
  v_lot_total  INTEGER;
  v_op_balance INTEGER;
  v_remaining  INTEGER;
  v_lot        RECORD;
  v_lot_deduct INTEGER;
BEGIN
  -- 1. Input cap
  IF cardinality(p_song_ids) > 500 THEN
    RAISE EXCEPTION 'unlock_songs_for_account: input cap exceeded (max 500, got %)',
      cardinality(p_song_ids);
  END IF;

  -- 2. Deduplicate input silently
  SELECT ARRAY(SELECT DISTINCT unnest(p_song_ids)) INTO v_deduped;

  -- 3. Validate ownership: every song must be currently liked by the account
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

  -- 4. Identify already-unlocked (active, non-revoked) songs
  SELECT ARRAY(
    SELECT asu.song_id
    FROM account_song_unlock asu
    WHERE asu.account_id = p_account_id
      AND asu.song_id = ANY(v_deduped)
      AND asu.revoked_at IS NULL
  ) INTO v_already;

  -- 5. Net-new = deduped minus already-unlocked
  SELECT ARRAY(
    SELECT s FROM unnest(v_deduped) AS s
    WHERE s <> ALL(v_already)
  ) INTO v_net_new;

  v_cost := cardinality(v_net_new);

  -- 6. Short-circuit: all songs already unlocked
  IF v_cost = 0 THEN
    RETURN jsonb_build_object(
      'newly_unlocked_song_ids',   '[]'::JSONB,
      'already_unlocked_song_ids', to_jsonb(v_already)
    );
  END IF;

  -- 7. Lock account_billing row before reading balance (prevents concurrent deductions)
  SELECT ab.credit_balance INTO v_balance
  FROM account_billing ab
  WHERE ab.account_id = p_account_id
  FOR UPDATE;

  -- 8. Compute reserved credits from pending conversion allocations
  SELECT COALESCE(SUM(scca.reserved_credits), 0) INTO v_reserved
  FROM subscription_credit_conversion_allocation scca
  JOIN subscription_credit_conversion scc ON scca.conversion_id = scc.id
  WHERE scc.account_id = p_account_id
    AND scc.status = 'pending';

  -- 9. Spendable balance check (credit_balance minus reserved conversion credits)
  IF (v_balance - v_reserved) < v_cost THEN
    RAISE EXCEPTION
      'unlock_songs_for_account: insufficient balance (credit_balance=%, reserved=%, cost=%)',
      v_balance, v_reserved, v_cost;
  END IF;

  -- 10. Compute operational balance = credit_balance minus sum of lot remaining_credits
  --     Clamp to 0 to guard against any transient imbalance
  SELECT GREATEST(v_balance - COALESCE(SUM(pcl.remaining_credits), 0), 0) INTO v_op_balance
  FROM pack_credit_lot pcl
  WHERE pcl.account_id = p_account_id;

  -- 11. Consume operational balance first, then FIFO from lots
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

  -- 12. Deduct from account_billing.credit_balance
  UPDATE account_billing
  SET credit_balance = credit_balance - v_cost
  WHERE account_id = p_account_id;

  -- 13. Append credit_transaction ledger row (immutable; amount is negative)
  INSERT INTO credit_transaction (account_id, amount, balance_after, reason, metadata)
  VALUES (
    p_account_id,
    -v_cost,
    v_balance - v_cost,
    'song_unlock',
    jsonb_build_object('song_count', v_cost)
  );

  -- 14. Insert unlock rows for net-new songs (source='pack')
  --     ON CONFLICT: if the existing row is revoked, re-activate it
  --     Active rows: WHERE clause prevents the UPDATE, row is left as-is
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
    'newly_unlocked_song_ids',   to_jsonb(v_net_new),
    'already_unlocked_song_ids', to_jsonb(v_already)
  );
END;
$$;


-- Function 2: Free/admin/pack unlock without balance mutation
CREATE OR REPLACE FUNCTION insert_song_unlocks_without_charge(
  p_account_id              UUID,
  p_song_ids                UUID[],
  p_source                  TEXT,
  p_granted_stripe_event_id TEXT DEFAULT NULL
) RETURNS TABLE(song_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  -- 'unlimited' is not valid here; use activate_unlimited_songs for that source
  IF p_source NOT IN ('free_auto', 'pack', 'self_hosted', 'admin') THEN
    RAISE EXCEPTION 'insert_song_unlocks_without_charge: invalid source ''%''', p_source;
  END IF;

  RETURN QUERY
  INSERT INTO account_song_unlock (account_id, song_id, source, granted_stripe_event_id)
  SELECT p_account_id, s, p_source, p_granted_stripe_event_id
  FROM unnest(p_song_ids) AS s
  ON CONFLICT (account_id, song_id) DO UPDATE
    SET source                  = EXCLUDED.source,
        granted_stripe_event_id = EXCLUDED.granted_stripe_event_id,
        revoked_at              = NULL,
        revoked_reason          = NULL,
        revoked_stripe_event_id = NULL
    WHERE account_song_unlock.revoked_at IS NOT NULL
  RETURNING account_song_unlock.song_id;
END;
$$;


-- Function 3: Content-activation unlock for unlimited subscribers
CREATE OR REPLACE FUNCTION activate_unlimited_songs(
  p_account_id                      UUID,
  p_granted_stripe_subscription_id  TEXT,
  p_granted_subscription_period_end TIMESTAMPTZ
) RETURNS TABLE(song_id UUID)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH account_visible_songs AS (
    SELECT ls.song_id
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM song_analysis sa WHERE sa.song_id = ls.song_id
      )
  ),
  upsert_item_status AS (
    INSERT INTO item_status (account_id, item_type, item_id)
    SELECT p_account_id, 'song'::item_type, avs.song_id
    FROM account_visible_songs avs
    ON CONFLICT (account_id, item_type, item_id) DO NOTHING
  ),
  upsert_unlock AS (
    INSERT INTO account_song_unlock (
      account_id,
      song_id,
      source,
      granted_stripe_subscription_id,
      granted_subscription_period_end
    )
    SELECT
      p_account_id,
      avs.song_id,
      'unlimited',
      p_granted_stripe_subscription_id,
      p_granted_subscription_period_end
    FROM account_visible_songs avs
    ON CONFLICT (account_id, song_id) DO UPDATE
      SET source                          = 'unlimited',
          granted_stripe_subscription_id  = EXCLUDED.granted_stripe_subscription_id,
          granted_subscription_period_end = EXCLUDED.granted_subscription_period_end,
          revoked_at                      = NULL,
          revoked_reason                  = NULL,
          revoked_stripe_event_id         = NULL
      WHERE account_song_unlock.revoked_at IS NOT NULL
  )
  SELECT song_id FROM account_visible_songs;
$$;
