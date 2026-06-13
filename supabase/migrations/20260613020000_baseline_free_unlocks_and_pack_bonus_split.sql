-- Baseline free unlocks + pack bonus split.
--
-- Product invariant:
--   - every eligible free account owns a baseline of up to 10 unlocks
--   - a song pack adds only +15 bonus unlocks on top of that baseline
--   - refunding/reversing a pack must reconcile back to the baseline instead
--     of leaving the account with zero unlocks
--
-- This migration applies the long-term model directly:
--   1. fulfill_pack_purchase tops up the baseline first, then grants only +15 pack rows
--   2. reverse_pack_entitlement revokes pack access, then tops the account back up
--      to the baseline when its active unlock total falls below 10
--   3. one-off backfill repairs already-completed free accounts currently below the
--      baseline without inflating active pack accounts above their intended total

-- One-off backfill: completed free-plan accounts with fewer than 10 active unlocks
-- should be topped up to the baseline from their current most-recent liked songs.
WITH eligible_accounts AS (
  SELECT
    a.id AS account_id,
    GREATEST(0, 10 - COALESCE(active_unlocks.count, 0)) AS missing_count
  FROM account a
  INNER JOIN user_preferences up
    ON up.account_id = a.id
   AND up.onboarding_completed_at IS NOT NULL
  INNER JOIN account_billing ab
    ON ab.account_id = a.id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS count
    FROM account_song_unlock asu
    WHERE asu.account_id = a.id
      AND asu.revoked_at IS NULL
  ) active_unlocks ON TRUE
  LEFT JOIN account_liked_song_access_grant grant_row
    ON grant_row.account_id = a.id
  WHERE ab.plan = 'free'
    AND ab.unlimited_access_source IS NULL
    AND COALESCE(active_unlocks.count, 0) < 10
    AND grant_row.account_id IS NULL
), ranked_candidates AS (
  SELECT
    ea.account_id,
    ls.song_id,
    ROW_NUMBER() OVER (
      PARTITION BY ea.account_id
      ORDER BY ls.liked_at DESC
    ) AS rn,
    ea.missing_count
  FROM eligible_accounts ea
  INNER JOIN liked_song ls
    ON ls.account_id = ea.account_id
   AND ls.unliked_at IS NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM account_song_unlock asu
    WHERE asu.account_id = ea.account_id
      AND asu.song_id = ls.song_id
      AND asu.revoked_at IS NULL
  )
)
INSERT INTO account_song_unlock (account_id, song_id, source)
SELECT rc.account_id, rc.song_id, 'free_auto'
FROM ranked_candidates rc
WHERE rc.rn <= rc.missing_count
ON CONFLICT (account_id, song_id) DO UPDATE
  SET source                  = 'free_auto',
      granted_stripe_event_id = NULL,
      revoked_at              = NULL,
      revoked_reason          = NULL,
      revoked_stripe_event_id = NULL
WHERE account_song_unlock.revoked_at IS NOT NULL;

CREATE OR REPLACE FUNCTION fulfill_pack_purchase(
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
    LIMIT 15
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
  v_lot                RECORD;
  v_balance            INTEGER;
  v_credits_to_sub     INTEGER;
  v_credits_spent      INTEGER;
  v_txn_reason         TEXT;
  v_revoke_reason      TEXT;
  v_bonus_revoked      UUID[];
  v_extra_revoked      UUID[];
  v_active_unlock_count INTEGER;
  v_missing_baseline   INTEGER;
  v_baseline_candidates UUID[];
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

  PERFORM reprioritize_pending_jobs_for_account(p_account_id);

  RETURN jsonb_build_object(
    'credits_reversed', v_credits_to_sub,
    'revoked_song_ids', to_jsonb(v_bonus_revoked || v_extra_revoked)
  );
END;
$$;
