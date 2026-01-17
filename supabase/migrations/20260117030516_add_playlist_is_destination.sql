-- Migration: add_playlist_is_destination
-- Status: NO-OP (column now exists in base playlist migration)
--
-- This migration originally added is_destination to playlist table.
-- After schema alignment, this column is now part of the base migration
-- (20260116160001_create_playlist.sql). This file is kept for migration
-- history consistency but performs no operations.

-- No-op: is_destination already exists in playlist table
SELECT 1;
