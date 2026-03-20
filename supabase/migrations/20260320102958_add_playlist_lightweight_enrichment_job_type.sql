-- Add playlist_lightweight_enrichment to the job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'playlist_lightweight_enrichment';
