-- Add new job_type enum values for the enrichment pipeline stages
ALTER TYPE job_type ADD VALUE 'audio_features';
ALTER TYPE job_type ADD VALUE 'song_embedding';
ALTER TYPE job_type ADD VALUE 'playlist_profiling';
