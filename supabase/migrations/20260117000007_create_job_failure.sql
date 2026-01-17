-- Create job_failure table for tracking individual item failures within jobs

-- Item type enum for failures
CREATE TYPE item_type AS ENUM ('song', 'playlist');

-- Error type enum for categorizing failures
CREATE TYPE error_type AS ENUM (
  'rate_limit',
  'not_found',
  'unauthorized',
  'network',
  'parse',
  'validation',
  'unknown'
);

CREATE TABLE job_failure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  item_type item_type NOT NULL,
  item_id TEXT NOT NULL,
  error_type error_type NOT NULL DEFAULT 'unknown',
  error_message TEXT,
  error_details JSONB,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- error_details JSONB structure (example):
-- {
--   "status_code": 429,
--   "retry_after": 30,
--   "endpoint": "/v1/audio-features",
--   "stack": "..."
-- }

-- Index for querying failures by job
CREATE INDEX idx_job_failure_job_id ON job_failure(job_id);

-- Index for querying failures by item
CREATE INDEX idx_job_failure_item ON job_failure(item_type, item_id);

-- Index for filtering by error type
CREATE INDEX idx_job_failure_error_type ON job_failure(error_type);

-- Enable RLS (service_role bypasses)
ALTER TABLE job_failure ENABLE ROW LEVEL SECURITY;
