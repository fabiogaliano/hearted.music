-- Durable per-attempt execution measurement for enrichment and match_snapshot_refresh jobs.
-- No automatic pruning in v1 — all rows retained.

CREATE TABLE job_execution_measurement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  workflow TEXT NOT NULL,
  queue_priority INTEGER,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  queued_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  outcome TEXT NOT NULL,
  details JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_job_execution_measurement_job
  ON job_execution_measurement(job_id);

CREATE INDEX idx_job_execution_measurement_account
  ON job_execution_measurement(account_id);

ALTER TABLE job_execution_measurement ENABLE ROW LEVEL SECURITY;
