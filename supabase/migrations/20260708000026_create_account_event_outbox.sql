-- Account-event outbox table (proposal §5.1, contract.md §2)
--
-- Durable outbox for semantic account events. Producers insert rows with
-- publish_id = NULL; the publisher assigns publish_id from the sequence.
-- The SSE replay cursor is publish_id, never id.

CREATE SEQUENCE public.account_event_publish_seq;

CREATE TABLE public.account_event (
  id            BIGSERIAL     PRIMARY KEY,
  publish_id    BIGINT        UNIQUE,
  account_id    UUID          NOT NULL REFERENCES public.account (id) ON DELETE CASCADE,
  type          TEXT          NOT NULL,
  payload       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.account_event IS
  'Durable outbox for account-scoped semantic events. '
  '`id` is insertion identity (never a client cursor). '
  '`publish_id` is the ordered replay cursor assigned by the publisher. '
  'Unpublished rows (publish_id IS NULL) must never be pruned.';

COMMENT ON COLUMN public.account_event.id IS
  'Insertion-order identity. Used internally for publish claims. Never exposed as a cursor.';

COMMENT ON COLUMN public.account_event.publish_id IS
  'Ordered replay cursor assigned by the publisher via account_event_publish_seq. '
  'The only value a client may persist. NULL until published.';

-- Replay path: WHERE account_id = :sub AND publish_id > :cursor ORDER BY publish_id
CREATE INDEX idx_account_event_replay
  ON public.account_event (account_id, publish_id)
  WHERE publish_id IS NOT NULL;

-- Publisher claim path: find unpublished rows efficiently
CREATE INDEX idx_account_event_unpublished
  ON public.account_event (id)
  WHERE publish_id IS NULL;

-- RLS enabled with deny-all policy — table is accessed only via direct
-- worker/app connections (service_role bypasses RLS), never PostgREST.
ALTER TABLE public.account_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_event_deny_all" ON public.account_event FOR ALL USING (false);
