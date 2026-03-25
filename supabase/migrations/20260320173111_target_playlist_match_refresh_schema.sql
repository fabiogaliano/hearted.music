-- Target playlist match refresh: column renames + new enum value
-- Must be a separate migration because ALTER TYPE ADD VALUE
-- cannot be referenced in the same transaction.

-- Rename destination → target terminology
ALTER TABLE playlist RENAME COLUMN is_destination TO is_target;
DROP INDEX IF EXISTS idx_playlist_destination;

ALTER TABLE user_preferences RENAME COLUMN rematch_job_id TO target_playlist_match_refresh_job_id;

-- Add the new job type enum value
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'target_playlist_match_refresh';
