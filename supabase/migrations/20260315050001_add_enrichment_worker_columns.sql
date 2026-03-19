-- Worker-related columns and polling index for enrichment jobs
-- (runs after enrichment enum value is committed in previous migration)

ALTER TABLE job ADD COLUMN heartbeat_at TIMESTAMPTZ;
ALTER TABLE job ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;

ALTER TABLE user_preferences ADD COLUMN enrichment_job_id UUID REFERENCES job(id) ON DELETE SET NULL;

CREATE INDEX idx_job_enrichment_poll ON job(type, status, created_at)
  WHERE type = 'enrichment' AND status = 'pending';
