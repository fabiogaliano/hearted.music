ALTER TABLE user_preferences ADD COLUMN demo_song_id UUID REFERENCES song(id) ON DELETE SET NULL;
