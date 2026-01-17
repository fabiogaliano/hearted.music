-- Create job table for sync operations and checkpoint tracking

-- Job type enum for all background job types
CREATE TYPE job_type AS ENUM (
  'sync_liked_songs',
  'sync_playlists',
  'song_analysis',
  'playlist_analysis',
  'matching'
);

-- Job status enum
CREATE TYPE job_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  type job_type NOT NULL,
  status job_status NOT NULL DEFAULT 'pending',
  progress JSONB DEFAULT '{}',
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- progress JSONB structure (unified for all job types):
-- {
--   "total": 1000,      -- total items to process
--   "done": 500,        -- items processed so far
--   "succeeded": 490,   -- items processed successfully
--   "failed": 10,       -- items that failed
--   "offset": 0,        -- current page offset (sync jobs)
--   "cursor": "...",    -- opaque checkpoint (sync jobs)
--   "checkpoint": "..." -- additional checkpoint data
-- }

-- Indexes for common queries
CREATE INDEX idx_job_account_id ON job(account_id);
CREATE INDEX idx_job_type ON job(account_id, type);
CREATE INDEX idx_job_status ON job(status) WHERE status IN ('pending', 'running');
CREATE INDEX idx_job_latest ON job(account_id, type, created_at DESC);

-- Enable RLS (service_role bypasses)
ALTER TABLE job ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER job_updated_at
  BEFORE UPDATE ON job
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
