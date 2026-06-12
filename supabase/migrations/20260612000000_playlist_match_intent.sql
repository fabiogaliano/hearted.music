-- Add match_intent column to playlist for our own, Spotify-decoupled intent text.
--
-- This is the text the matching pipeline reads (buildIntentText, intent
-- embedding, computeIntentWeight). Unlike `description` (which mirrors Spotify
-- and syncs both ways via the extension), match_intent is app-local: it never
-- syncs to Spotify and is the only intent text our UI surfaces. Nullable with no
-- default — pre-prod, the column starts empty for everyone (no backfill). The
-- CHECK is enforced at the DB layer so the server fn and any future direct-insert
-- path both go through the same guard.

ALTER TABLE playlist ADD COLUMN match_intent TEXT;

ALTER TABLE playlist
  ADD CONSTRAINT playlist_match_intent_max_len
    CHECK (match_intent IS NULL OR char_length(match_intent) <= 5000);
