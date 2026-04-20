-- Bridge event idempotency: record processing OUTCOME, not arrival.
--
-- Previously billing_bridge_event was a pure arrival table: a row's existence
-- meant "this stripe_event_id was seen." If the dispatch handler threw AFTER
-- the row was inserted, the route returned 500 but the row persisted, and
-- every upstream retry hit the duplicate short-circuit and silently dropped
-- the entitlement update.
--
-- New shape mirrors billing_webhook_event: explicit status state machine
-- (processing | processed | failed) plus a lease timestamp so a server crash
-- mid-dispatch does not permanently wedge an event in 'processing'.
--
-- Claim/reclaim is done via a SECURITY DEFINER RPC that combines
-- INSERT ... ON CONFLICT DO UPDATE ... WHERE (predicate) RETURNING,
-- giving us compare-and-swap semantics in a single statement.

-- 1. Schema evolution
ALTER TABLE billing_bridge_event
  ADD COLUMN status TEXT NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processing', 'processed', 'failed')),
  ADD COLUMN processing_started_at TIMESTAMPTZ,
  ADD COLUMN error_message TEXT,
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- processed_at must now be nullable: rows in 'processing' have no processed_at.
ALTER TABLE billing_bridge_event
  ALTER COLUMN processed_at DROP NOT NULL,
  ALTER COLUMN processed_at DROP DEFAULT;

-- Drop the default on status so future inserts are forced to be explicit.
-- (The DEFAULT above exists solely to backfill pre-existing rows.)
ALTER TABLE billing_bridge_event
  ALTER COLUMN status DROP DEFAULT;

-- Index to support lease-timeout sweeps and status-filtered reads.
CREATE INDEX idx_billing_bridge_event_status_started
  ON billing_bridge_event(status, processing_started_at);

-- 2. updated_at maintenance trigger (same pattern as billing_webhook_event).
CREATE TRIGGER billing_bridge_event_updated_at
  BEFORE UPDATE ON billing_bridge_event
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 3. Atomic claim RPC.
--
-- Outcomes:
--   'claimed'             — caller must run the handler, then finalize.
--   'duplicate_processed' — event already handled successfully; no-op.
--   'in_progress'         — another worker holds a valid lease; caller should
--                           return 409 and let the upstream retry later.
--
-- A row in 'processing' whose processing_started_at is older than the lease
-- window is treated as abandoned and reclaimable (crash recovery).
CREATE OR REPLACE FUNCTION claim_billing_bridge_event(
  p_stripe_event_id TEXT,
  p_event_kind TEXT,
  p_lease_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lease_interval INTERVAL := make_interval(secs => p_lease_ms / 1000.0);
  v_claimed_id TEXT;
  v_current_status TEXT;
  v_started TIMESTAMPTZ;
BEGIN
  -- Single-statement compare-and-swap. Inserts a new row, OR updates an
  -- existing row iff it is 'failed' or its 'processing' lease has expired.
  -- A row in 'processed' or 'processing' (valid lease) is left untouched
  -- and RETURNING returns zero rows.
  INSERT INTO billing_bridge_event (
    stripe_event_id,
    event_kind,
    status,
    processing_started_at,
    processed_at,
    error_message
  )
  VALUES (
    p_stripe_event_id,
    p_event_kind,
    'processing',
    now(),
    NULL,
    NULL
  )
  ON CONFLICT (stripe_event_id) DO UPDATE
    SET status = 'processing',
        processing_started_at = now(),
        processed_at = NULL,
        error_message = NULL,
        event_kind = EXCLUDED.event_kind
    WHERE billing_bridge_event.status = 'failed'
       OR (billing_bridge_event.status = 'processing'
           AND billing_bridge_event.processing_started_at < now() - v_lease_interval)
  RETURNING stripe_event_id INTO v_claimed_id;

  IF v_claimed_id IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  -- We did not claim. Look at the current row to decide which non-claim
  -- outcome applies.
  SELECT status, processing_started_at
    INTO v_current_status, v_started
    FROM billing_bridge_event
   WHERE stripe_event_id = p_stripe_event_id;

  IF v_current_status = 'processed' THEN
    RETURN 'duplicate_processed';
  END IF;

  -- Only remaining case under normal operation is a valid 'processing' lease.
  RETURN 'in_progress';
END;
$$;

-- 4. Finalization RPCs.
--
-- Separate helpers for processed/failed keep the route code declarative and
-- give us a single auditable write site per terminal state.
CREATE OR REPLACE FUNCTION mark_billing_bridge_event_processed(
  p_stripe_event_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE billing_bridge_event
     SET status = 'processed',
         processed_at = now(),
         processing_started_at = NULL,
         error_message = NULL
   WHERE stripe_event_id = p_stripe_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION mark_billing_bridge_event_failed(
  p_stripe_event_id TEXT,
  p_error_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE billing_bridge_event
     SET status = 'failed',
         processing_started_at = NULL,
         error_message = p_error_message
   WHERE stripe_event_id = p_stripe_event_id;
END;
$$;

-- Lock down the RPCs to service_role only (same posture as the table RLS).
REVOKE EXECUTE ON FUNCTION claim_billing_bridge_event(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION mark_billing_bridge_event_processed(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION mark_billing_bridge_event_failed(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION claim_billing_bridge_event(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION mark_billing_bridge_event_processed(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION mark_billing_bridge_event_failed(TEXT, TEXT) TO service_role;
