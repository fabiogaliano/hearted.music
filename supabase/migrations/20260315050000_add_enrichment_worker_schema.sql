-- Add enrichment job type (must be in its own migration so the value
-- is committed before other migrations reference it in indexes/filters)
ALTER TYPE job_type ADD VALUE 'enrichment';
