-- Per-(song, playlist) user decisions about match suggestions
-- Replaces the per-song action_type on item_status with per-playlist granularity

CREATE TABLE match_decision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,  -- 'added' | 'dismissed'
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, song_id, playlist_id)
);

CREATE INDEX idx_match_decision_account ON match_decision(account_id);
CREATE INDEX idx_match_decision_song ON match_decision(account_id, song_id);

ALTER TABLE match_decision ENABLE ROW LEVEL SECURITY;
