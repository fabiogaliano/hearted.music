-- Add is_destination column to playlist table
-- Used to mark playlists as destinations for auto-sorting liked songs

ALTER TABLE playlist
ADD COLUMN is_destination BOOLEAN DEFAULT false NOT NULL;

-- Index for efficient destination playlist queries
CREATE INDEX idx_playlist_destination ON playlist(account_id) WHERE is_destination = true;

-- Comment for documentation
COMMENT ON COLUMN playlist.is_destination IS 'When true, this playlist is a destination for auto-sorted liked songs';
