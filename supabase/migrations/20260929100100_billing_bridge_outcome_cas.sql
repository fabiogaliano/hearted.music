-- Make billing_bridge_event finalization compare-and-set on the claim.
--
-- mark_billing_bridge_event_processed/_failed used to update by
-- stripe_event_id alone. A worker whose lease expired (and whose event was
-- reclaimed by another worker) could still finalize the row: flipping a
-- 'processed' outcome to 'failed' so the next upstream retry re-ran the
-- handler, or releasing a live reclaim so a third run overlapped it.
--
-- The claim recorded no holder identity (processing_started_at is not
-- returned to the caller), so this adds a nullable claim_token the caller
-- supplies at claim time and must present to finalize.
--
-- Rolling deploy: every new parameter defaults to NULL, so the pre-token app
-- keeps calling with the old named arguments. Its claims store a NULL token
-- and its finalizers match NULL via IS NOT DISTINCT FROM; they still gain the
-- status = 'processing' guard. Functions are dropped and recreated (not
-- overloaded) because a defaulted overload would make the old-arity call
-- ambiguous. Expand-only: no data is removed.

ALTER TABLE billing_bridge_event
  ADD COLUMN claim_token UUID;

DROP FUNCTION claim_billing_bridge_event(TEXT, TEXT, INTEGER);
DROP FUNCTION mark_billing_bridge_event_processed(TEXT);
DROP FUNCTION mark_billing_bridge_event_failed(TEXT, TEXT);

CREATE FUNCTION claim_billing_bridge_event(
  p_stripe_event_id TEXT,
  p_event_kind TEXT,
  p_lease_ms INTEGER,
  p_claim_token UUID DEFAULT NULL
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
  INSERT INTO billing_bridge_event (
    stripe_event_id,
    event_kind,
    status,
    processing_started_at,
    processed_at,
    error_message,
    claim_token
  )
  VALUES (
    p_stripe_event_id,
    p_event_kind,
    'processing',
    now(),
    NULL,
    NULL,
    p_claim_token
  )
  ON CONFLICT (stripe_event_id) DO UPDATE
    SET status = 'processing',
        processing_started_at = now(),
        processed_at = NULL,
        error_message = NULL,
        event_kind = EXCLUDED.event_kind,
        claim_token = EXCLUDED.claim_token
    WHERE billing_bridge_event.status = 'failed'
       OR (billing_bridge_event.status = 'processing'
           AND billing_bridge_event.processing_started_at < now() - v_lease_interval)
  RETURNING stripe_event_id INTO v_claimed_id;

  IF v_claimed_id IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT status
    INTO v_current_status
    FROM billing_bridge_event
   WHERE stripe_event_id = p_stripe_event_id;

  IF v_current_status = 'processed' THEN
    RETURN 'duplicate_processed';
  END IF;

  RETURN 'in_progress';
END;
$$;

-- Both finalizers are no-ops unless the caller still holds the claim, so a
-- stale holder can neither overwrite a terminal outcome nor release a lease
-- someone else reclaimed.
CREATE FUNCTION mark_billing_bridge_event_processed(
  p_stripe_event_id TEXT,
  p_claim_token UUID DEFAULT NULL
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
   WHERE stripe_event_id = p_stripe_event_id
     AND status = 'processing'
     AND claim_token IS NOT DISTINCT FROM p_claim_token;
END;
$$;

CREATE FUNCTION mark_billing_bridge_event_failed(
  p_stripe_event_id TEXT,
  p_error_message TEXT,
  p_claim_token UUID DEFAULT NULL
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
   WHERE stripe_event_id = p_stripe_event_id
     AND status = 'processing'
     AND claim_token IS NOT DISTINCT FROM p_claim_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.claim_billing_bridge_event(TEXT, TEXT, INTEGER, UUID),
  public.mark_billing_bridge_event_processed(TEXT, UUID),
  public.mark_billing_bridge_event_failed(TEXT, TEXT, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.claim_billing_bridge_event(TEXT, TEXT, INTEGER, UUID),
  public.mark_billing_bridge_event_processed(TEXT, UUID),
  public.mark_billing_bridge_event_failed(TEXT, TEXT, UUID)
TO service_role;

NOTIFY pgrst, 'reload schema';
