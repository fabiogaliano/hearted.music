-- mark_billing_bridge_event_processed/_failed now return whether the caller
-- still held the claim (i.e. whether the row was updated).
--
-- A finalizer from a run that lost its lease is a silent no-op, and with a
-- VOID return the route could not tell, so it answered 200 and emitted
-- payment_processed analytics for an event another run now owns.
--
-- Rolling deploy: the argument lists and defaults are unchanged, so app code
-- deployed before this migration keeps calling with the same named arguments
-- and simply ignores the new return value. A return type cannot be changed by
-- CREATE OR REPLACE, hence DROP/CREATE inside this migration's transaction;
-- the drop also discards the grants, which are re-applied below.

DROP FUNCTION mark_billing_bridge_event_processed(TEXT, UUID);
DROP FUNCTION mark_billing_bridge_event_failed(TEXT, TEXT, UUID);

CREATE FUNCTION mark_billing_bridge_event_processed(
  p_stripe_event_id TEXT,
  p_claim_token UUID DEFAULT NULL
)
RETURNS BOOLEAN
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
   WHERE stripe_event_id = p_stripe_event_id
     AND status = 'processing'
     AND claim_token IS NOT DISTINCT FROM p_claim_token;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION mark_billing_bridge_event_failed(
  p_stripe_event_id TEXT,
  p_error_message TEXT,
  p_claim_token UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE billing_bridge_event
     SET status = 'failed',
         processing_started_at = NULL,
         error_message = p_error_message
   WHERE stripe_event_id = p_stripe_event_id
     AND status = 'processing'
     AND claim_token IS NOT DISTINCT FROM p_claim_token;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.mark_billing_bridge_event_processed(TEXT, UUID),
  public.mark_billing_bridge_event_failed(TEXT, TEXT, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.mark_billing_bridge_event_processed(TEXT, UUID),
  public.mark_billing_bridge_event_failed(TEXT, TEXT, UUID)
TO service_role;

NOTIFY pgrst, 'reload schema';
