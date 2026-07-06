-- Match deck read model, Phase 2 (plan §5.3 / §6 / §11): the deck-job enqueue
-- RPC. Additive — no table/column changes.
--
-- Why an RPC (not a supabase-js `.upsert`): dedupe binds the partial unique
-- index idx_match_review_deck_job_idempotency_key_active
-- (`... ON (idempotency_key) WHERE status NOT IN ('completed','dead')`,
-- 20260706000005_deck_read_model_deck_job_table.sql). supabase-js `.upsert`'s
-- `onConflict` can only name columns, never the index's WHERE predicate, so it
-- cannot target a partial index. Every deck-job enqueue therefore goes through
-- this function, matching the ON CONFLICT ... DO NOTHING pattern the four
-- action RPCs already use inline (20260706000009_extend_deck_action_rpcs.sql).
--
-- No pg_notify: the poll loop covers pickup and the plan makes the job_created
-- NOTIFY fast path explicitly optional (§5.3). Skipped here to keep scope tight.
--
-- Serialization (one running job per account+orientation) is enforced by the
-- claim function's NOT EXISTS check, not at enqueue time — a job may be pending
-- while a sibling for the same account+orientation runs.

CREATE OR REPLACE FUNCTION public.enqueue_match_review_deck_job(
  p_account_id      UUID,
  p_orientation     TEXT,
  p_kind            TEXT,
  p_idempotency_key TEXT,
  p_session_id      UUID DEFAULT NULL,
  p_payload         JSONB DEFAULT '{}'::jsonb
)
RETURNS SETOF public.match_review_deck_job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.match_review_deck_job (
    account_id, orientation, session_id, kind, idempotency_key, payload
  ) VALUES (
    p_account_id, p_orientation, p_session_id, p_kind, p_idempotency_key, p_payload
  )
  -- Binds idx_match_review_deck_job_idempotency_key_active: a duplicate enqueue
  -- while a prior job for this key is still non-terminal is a no-op; once that
  -- prior job completes/dies the key frees and a fresh enqueue inserts again.
  ON CONFLICT (idempotency_key) WHERE status NOT IN ('completed', 'dead')
  DO NOTHING
  RETURNING *;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_match_review_deck_job(UUID, TEXT, TEXT, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_match_review_deck_job(UUID, TEXT, TEXT, TEXT, UUID, JSONB)
  TO service_role;
