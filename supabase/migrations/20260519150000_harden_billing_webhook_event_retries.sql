-- Billing webhook retries: claim processing OUTCOME, not mere arrival.
--
-- Today the billing service returns 500 on failed internal processing so
-- Stripe will retry. Without reclaim semantics, that retry immediately hits
-- the existing billing_webhook_event row and is treated as a duplicate even
-- when the prior attempt failed or crashed mid-handler.
--
-- This migration mirrors the app bridge hardening: add a processing lease and
-- atomic claim RPC so failed or abandoned webhook events can be retried.

ALTER TABLE billing_webhook_event
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_billing_webhook_event_status_started
  ON billing_webhook_event(status, processing_started_at);

CREATE OR REPLACE FUNCTION claim_billing_webhook_event(
  p_stripe_event_id TEXT,
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
BEGIN
  INSERT INTO billing_webhook_event (
    stripe_event_id,
    status,
    processing_started_at,
    processed_at,
    error_message
  )
  VALUES (
    p_stripe_event_id,
    'processing',
    now(),
    NULL,
    NULL
  )
  ON CONFLICT (stripe_event_id) DO UPDATE
    SET status = 'processing',
        processing_started_at = now(),
        processed_at = NULL,
        error_message = NULL
    WHERE billing_webhook_event.status = 'failed'
       OR (billing_webhook_event.status = 'processing'
           AND billing_webhook_event.processing_started_at < now() - v_lease_interval)
  RETURNING stripe_event_id INTO v_claimed_id;

  IF v_claimed_id IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT status
    INTO v_current_status
    FROM billing_webhook_event
   WHERE stripe_event_id = p_stripe_event_id;

  IF v_current_status = 'processed' THEN
    RETURN 'duplicate_processed';
  END IF;

  RETURN 'in_progress';
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_billing_webhook_event(TEXT, INTEGER)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION claim_billing_webhook_event(TEXT, INTEGER)
TO service_role;
