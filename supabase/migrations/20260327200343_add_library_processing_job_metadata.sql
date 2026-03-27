-- Job-level scheduling metadata for library-processing control plane.
-- satisfies_requested_at: the request marker the job was created to satisfy.
-- queue_priority: numeric priority for mixed-workflow claim ordering.

ALTER TABLE job ADD COLUMN satisfies_requested_at TIMESTAMPTZ;
ALTER TABLE job ADD COLUMN queue_priority INTEGER;

-- Add match_snapshot_refresh as a new job type enum value.
-- Must be committed before functions can reference it (separate migration).
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'match_snapshot_refresh';
