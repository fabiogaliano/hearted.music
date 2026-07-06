-- Match deck read model, Phase 1a (plan §5.3): durable deck jobs, table only.
--
-- A dedicated table, not an overload of the generic `job` table: `job` has no
-- payload column and its one-active-row-per-account-per-type partial-index
-- idempotency is too coarse for kind+snapshot+hash dedupe. This is the same
-- reasoning that gave audio_feature_backfill_job its own table, and this
-- table follows that precedent's shape (dedicated leasing columns, `FOR
-- UPDATE SKIP LOCKED` claim, stale-lease sweep) — but uses the plan's field
-- names (available_at, heartbeat_at) rather than the audio-feature table's
-- (not_before/locked_at/lease_expires_at), per plan §5.3's exact field list.
--
-- Deviation from the audio_feature precedent: no locked_by/worker-fencing
-- column. The plan's field list for this table has no such column, and
-- settlement RPCs (which would need a fence) are out of scope for Phase 1a
-- ("no RPCs beyond the deck-job claim/sweep/dead functions"). Logged in
-- claudedocs/orchestration-deck-read-model-decisions.md.

CREATE TABLE public.match_review_deck_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  orientation TEXT NOT NULL CHECK (orientation IN ('song', 'playlist')),
  -- Nullable: build_proposals jobs are sessionless; append_sessions and
  -- capture_ahead jobs target one active session.
  session_id UUID REFERENCES public.match_review_session(id) ON DELETE SET NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('build_proposals', 'append_sessions', 'capture_ahead', 'repair')),
  -- e.g. build:{account}:{orientation}:{snapshot}:{hash}. Unique only while
  -- the job is non-terminal (index below) so a retried build after a prior
  -- one completed/died can re-enqueue under the same key.
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The per-account+orientation serialization guarantee is enforced by the
-- claim function's NOT EXISTS check (below, in the sibling functions
-- migration), not by an index constraint — a job can be pending for the same
-- account+orientation as one currently running; the index here just makes
-- that check and the poll query fast.
CREATE INDEX idx_match_review_deck_job_running_account_orientation
  ON public.match_review_deck_job (account_id, orientation)
  WHERE status = 'running';

CREATE INDEX idx_match_review_deck_job_pending_poll
  ON public.match_review_deck_job (available_at ASC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX idx_match_review_deck_job_session
  ON public.match_review_deck_job (session_id)
  WHERE session_id IS NOT NULL;

-- Unique while non-terminal: 'completed' and 'dead' are the terminal
-- statuses, matching the CHECK constraint's vocabulary.
CREATE UNIQUE INDEX idx_match_review_deck_job_idempotency_key_active
  ON public.match_review_deck_job (idempotency_key)
  WHERE status NOT IN ('completed', 'dead');

ALTER TABLE public.match_review_deck_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY "match_review_deck_job_deny_all"
  ON public.match_review_deck_job FOR ALL USING (false);

CREATE TRIGGER match_review_deck_job_updated_at
  BEFORE UPDATE ON public.match_review_deck_job
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
