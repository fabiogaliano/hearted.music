-- Separates mutable UX state from the immutable match_snapshot/match_result layer so
-- review sessions can be paused, resumed, and replayed without touching read-only data.

CREATE TABLE match_review_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  strictness_preset TEXT NOT NULL,
  strictness_min_score DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- At most one active session per account so concurrent clients share state
CREATE UNIQUE INDEX idx_match_review_session_one_active
ON match_review_session(account_id)
WHERE status = 'active';

CREATE INDEX idx_match_review_session_account_created
ON match_review_session(account_id, created_at DESC);

ALTER TABLE match_review_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY "match_review_session_deny_all" ON match_review_session FOR ALL USING (false);


CREATE TABLE match_review_queue_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES match_review_session(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  source_snapshot_id UUID NOT NULL REFERENCES match_snapshot(id),
  position INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'presented', 'completed', 'skipped', 'unavailable')),
  resolution TEXT CHECK (resolution IN ('added', 'dismissed', 'skipped', 'unavailable')),
  source_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  was_new_at_enqueue BOOLEAN NOT NULL DEFAULT false,
  presented_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Queue ordering is stable per session: each position is unique and each song appears once
CREATE UNIQUE INDEX idx_match_review_queue_item_session_position
ON match_review_queue_item(session_id, position);

CREATE UNIQUE INDEX idx_match_review_queue_item_session_song
ON match_review_queue_item(session_id, song_id);

-- Prevents double-enqueuing the same song from the same snapshot during idempotent appends
CREATE UNIQUE INDEX idx_match_review_queue_item_session_snapshot_song
ON match_review_queue_item(session_id, source_snapshot_id, song_id);

CREATE INDEX idx_match_review_queue_item_session_state_position
ON match_review_queue_item(session_id, state, position);

CREATE INDEX idx_match_review_queue_item_account_state
ON match_review_queue_item(account_id, state);

ALTER TABLE match_review_queue_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY "match_review_queue_item_deny_all" ON match_review_queue_item FOR ALL USING (false);


-- Tracks which snapshots have been applied to each session so re-syncing is a no-op
CREATE TABLE match_review_session_snapshot (
  session_id UUID NOT NULL REFERENCES match_review_session(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES match_snapshot(id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  appended_item_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, snapshot_id)
);

ALTER TABLE match_review_session_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "match_review_session_snapshot_deny_all" ON match_review_session_snapshot FOR ALL USING (false);


-- Optional linkage from a decision back to the queue item that surfaced it;
-- enables analytics and replay without being required for existing decision flows
ALTER TABLE match_decision
ADD COLUMN queue_item_id UUID REFERENCES match_review_queue_item(id);

-- Partial index keeps lookups fast while not penalising the NULL-majority rows
CREATE INDEX idx_match_decision_queue_item
ON match_decision(queue_item_id)
WHERE queue_item_id IS NOT NULL;
