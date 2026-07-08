-- Task 14: Worker NOTIFY wake-up parity

-- 1. Trigger for library processing jobs
CREATE OR REPLACE FUNCTION notify_library_processing_job_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Notify on any pending library processing job
  -- The payload is kept minimal.
  PERFORM pg_notify(
    'library_processing_job_created',
    json_build_object('id', NEW.id, 'type', NEW.type)::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_library_processing_job_created ON public.job;
CREATE TRIGGER on_library_processing_job_created
AFTER INSERT OR UPDATE OF status, available_at ON public.job
FOR EACH ROW
WHEN (NEW.type IN ('enrichment', 'match_snapshot_refresh') AND NEW.status = 'pending')
EXECUTE FUNCTION notify_library_processing_job_created();

-- 2. Modify enqueue_match_review_deck_job to include pg_notify
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
  WITH inserted AS (
    INSERT INTO public.match_review_deck_job (
      account_id, orientation, session_id, kind, idempotency_key, payload
    ) VALUES (
      p_account_id, p_orientation, p_session_id, p_kind, p_idempotency_key, p_payload
    )
    ON CONFLICT (idempotency_key) WHERE status NOT IN ('completed', 'dead')
    DO NOTHING
    RETURNING *
  ), notified AS (
    SELECT inserted.*, pg_notify(
      'match_deck_job_created',
      json_build_object('id', inserted.id, 'kind', inserted.kind)::text
    )
    FROM inserted
  )
  SELECT
    id, account_id, orientation, session_id, kind, payload,
    status, attempts, idempotency_key,
    created_at, updated_at, started_at, heartbeat_at, completed_at
  FROM notified;
$$;
