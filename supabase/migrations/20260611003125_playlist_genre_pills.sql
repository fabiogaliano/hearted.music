-- Add genre_pills column to playlist for user-declared genre steering.
--
-- Pills are app-local (Spotify has no genre field). At most 5 canonical whitelist
-- genres per playlist. The CHECK is enforced at the DB layer so the server fn
-- and any future direct-insert path both go through the same guard.

ALTER TABLE playlist
  ADD COLUMN genre_pills TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE playlist
  ADD CONSTRAINT playlist_genre_pills_max_5
    CHECK (cardinality(genre_pills) <= 5);
