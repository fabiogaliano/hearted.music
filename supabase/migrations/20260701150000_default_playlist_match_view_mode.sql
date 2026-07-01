-- Playlist mode is now the canonical/default match orientation.
-- Existing explicit user preferences are preserved; this affects newly-created
-- preference rows that rely on the DB default.

ALTER TABLE public.user_preferences
  ALTER COLUMN match_view_mode SET DEFAULT 'playlist';
