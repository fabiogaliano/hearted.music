-- Dedicated, onboarding-scoped persistence for the walkthrough match preview.
-- Holds at most one row per account: the demo-song-vs-target-playlists scoring
-- result that the walkthrough UI polls. Deliberately separate from
-- match_snapshot / match_result so production matching state stays untouched.

CREATE TYPE walkthrough_preview_status AS ENUM ('pending', 'ready', 'failed');

CREATE TABLE walkthrough_match_preview (
  account_id UUID PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  demo_song_id UUID REFERENCES song(id) ON DELETE SET NULL,
  -- Sorted target playlist ids that this preview was computed against.
  -- Used together with demo_song_id to detect stale state on read.
  target_playlist_ids UUID[] NOT NULL DEFAULT '{}',
  -- Stable hash of (demo_song_id, sorted target_playlist_ids). When the user
  -- changes either, ensure() rewrites this and getDemoSongMatches() treats
  -- mismatches as pending so the UI keeps polling instead of showing stale
  -- scores.
  fingerprint TEXT NOT NULL,
  status walkthrough_preview_status NOT NULL DEFAULT 'pending',
  -- Array of { playlistId, score, factors } objects.
  matches JSONB NOT NULL DEFAULT '[]'::JSONB,
  job_id UUID REFERENCES job(id) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_walkthrough_match_preview_job_id
  ON walkthrough_match_preview(job_id)
  WHERE job_id IS NOT NULL;

ALTER TABLE walkthrough_match_preview ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER walkthrough_match_preview_updated_at
  BEFORE UPDATE ON walkthrough_match_preview
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- At most one active walkthrough_match_preview job per account. The preview is
-- a single, latest-wins computation; if the user changes inputs we cancel the
-- in-flight one by replacing it (delete-then-insert pattern in app code).
CREATE UNIQUE INDEX idx_unique_active_walkthrough_preview_per_account
  ON job (account_id)
  WHERE type = 'walkthrough_match_preview' AND status IN ('pending', 'running');

-- Sibling claim RPC: deliberately does NOT share rows with the library
-- processing claim path. This isolates the preview's lifecycle so a runner
-- bug here cannot stall production enrichment / match snapshot refresh.
CREATE OR REPLACE FUNCTION claim_pending_walkthrough_preview_job()
RETURNS SETOF job
LANGUAGE sql
VOLATILE
SECURITY DEFINER
AS $$
  UPDATE job
  SET
    status = 'running',
    attempts = attempts + 1,
    started_at = now(),
    heartbeat_at = now(),
    updated_at = now()
  WHERE id = (
    SELECT id FROM job
    WHERE type = 'walkthrough_match_preview'
      AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
