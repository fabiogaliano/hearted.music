-- Add phase_job_ids column to user_preferences for onboarding resumability
-- Stores active sync job IDs (3 phases) so users can resume onboarding after refresh
-- Uses JSONB to store { liked_songs: uuid, playlists: uuid, playlist_tracks: uuid }

ALTER TABLE user_preferences
ADD COLUMN phase_job_ids JSONB DEFAULT NULL;

COMMENT ON COLUMN user_preferences.phase_job_ids IS 'Active sync phase job IDs for 3-phase parallel onboarding resumability';
