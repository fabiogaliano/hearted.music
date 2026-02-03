-- Add artist_ids column to song table for efficient artist image caching
-- Stores Spotify artist IDs parallel to the existing artists (names) array
-- Enables cache-by-artistId (100% deduplication) instead of cache-by-trackId

ALTER TABLE song
ADD COLUMN artist_ids TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN song.artist_ids IS 'Spotify artist IDs, parallel to artists array. Enables efficient artist image caching.';
