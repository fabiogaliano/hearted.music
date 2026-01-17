-- Create job_failure table for tracking individual item failures within jobs

-- Item type enum for failures (shared with item_status)
CREATE TYPE item_type AS ENUM ('song', 'playlist');

CREATE TABLE job_failure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  item_type item_type NOT NULL,
  item_id UUID NOT NULL,  -- UUID reference to song.id or playlist.id
  error_type TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- error_type examples: 'rate_limit', 'not_found', 'unauthorized', 'network', 'parse', 'validation', 'unknown'
-- Using TEXT instead of enum for flexibility

-- Index for querying failures by job
CREATE INDEX idx_job_failure_job_id ON job_failure(job_id);

-- Index for querying failures by job and item type
CREATE INDEX idx_job_failure_job_type ON job_failure(job_id, item_type);

-- Enable RLS (service_role bypasses)
ALTER TABLE job_failure ENABLE ROW LEVEL SECURITY;
