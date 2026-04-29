-- Drop unused song columns (not available via Pathfinder API)
ALTER TABLE song DROP COLUMN IF EXISTS preview_url;
ALTER TABLE song DROP COLUMN IF EXISTS popularity;
ALTER TABLE song DROP COLUMN IF EXISTS isrc;

-- Add artist biography
ALTER TABLE artist ADD COLUMN IF NOT EXISTS bio text;
