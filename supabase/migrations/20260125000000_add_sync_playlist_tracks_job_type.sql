-- Add sync_playlist_tracks to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'sync_playlist_tracks';
