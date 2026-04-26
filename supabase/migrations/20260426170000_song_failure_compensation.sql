-- Auto replacement credit for terminal no-analysis pack unlocks.
--
-- When a song that an account paid for via a pack becomes terminally
-- non-analyzable (`analysis_inputs_missing`), the account is owed a
-- replacement credit. This migration adds:
--
--   1. song_failure_compensation: idempotency table — one row per
--      (account_id, song_id, failure_code) tuple ever compensated.
--   2. grant_analysis_failure_replacement_credit: atomic RPC that
--      checks eligibility (active pack unlock + supported failure code),
--      records the compensation row, and grants 1 credit via
--      grant_credits('replacement_grant').
--
-- The RPC returns a discriminated JSONB payload so the TypeScript
-- caller does not need to parse exception strings:
--   { status: 'granted',             credits, new_balance }
--   { status: 'already_compensated' }
--   { status: 'not_eligible' }
--
-- Idempotency is enforced by the UNIQUE(account_id, song_id, failure_code)
-- constraint plus INSERT ... ON CONFLICT DO NOTHING — race-safe even under
-- concurrent stage runs.

CREATE TABLE song_failure_compensation (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id       UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  failure_code  TEXT NOT NULL,
  credit_amount INTEGER NOT NULL DEFAULT 1
                  CHECK (credit_amount > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(account_id, song_id, failure_code)
);

CREATE INDEX idx_song_failure_compensation_account
  ON song_failure_compensation(account_id);

ALTER TABLE song_failure_compensation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "song_failure_compensation_deny_all"
  ON song_failure_compensation
  FOR ALL
  USING (false);

CREATE OR REPLACE FUNCTION grant_analysis_failure_replacement_credit(
  p_account_id   UUID,
  p_song_id      UUID,
  p_failure_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_id  UUID;
  v_new_balance  INTEGER;
BEGIN
  IF p_failure_code <> 'analysis_inputs_missing' THEN
    RETURN jsonb_build_object('status', 'not_eligible');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM account_song_unlock asu
    WHERE asu.account_id = p_account_id
      AND asu.song_id    = p_song_id
      AND asu.source     = 'pack'
      AND asu.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'not_eligible');
  END IF;

  -- Idempotency gate: insert succeeds at most once per
  -- (account, song, failure_code). A second concurrent caller
  -- gets DO NOTHING and returns 'already_compensated' below.
  INSERT INTO song_failure_compensation (
    account_id, song_id, failure_code, credit_amount
  ) VALUES (
    p_account_id, p_song_id, p_failure_code, 1
  )
  ON CONFLICT (account_id, song_id, failure_code) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RETURN jsonb_build_object('status', 'already_compensated');
  END IF;

  v_new_balance := grant_credits(p_account_id, 1, 'replacement_grant', NULL);

  RETURN jsonb_build_object(
    'status',      'granted',
    'credits',     1,
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION grant_analysis_failure_replacement_credit(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grant_analysis_failure_replacement_credit(UUID, UUID, TEXT) TO service_role;
