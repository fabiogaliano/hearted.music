-- Create song_audio_feature table for ReccoBeats audio analysis data

CREATE TABLE song_audio_feature (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  acousticness REAL,
  danceability REAL,
  energy REAL,
  instrumentalness REAL,
  liveness REAL,
  loudness REAL,
  speechiness REAL,
  valence REAL,
  tempo REAL,
  time_signature INTEGER,
  key INTEGER,
  mode INTEGER,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(song_id)
);

-- Index for joins with song table
CREATE INDEX idx_song_audio_feature_song_id ON song_audio_feature(song_id);

-- Enable RLS (service_role bypasses)
ALTER TABLE song_audio_feature ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at timestamp
CREATE TRIGGER song_audio_feature_updated_at
  BEFORE UPDATE ON song_audio_feature
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
