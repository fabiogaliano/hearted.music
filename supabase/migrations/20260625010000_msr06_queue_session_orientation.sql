-- MSR-06: Queue/session orientation schema and lifecycle migration.
--
-- Adds orientation to sessions and queue items so song-mode and playlist-mode
-- match passes are independent. Adds visibility_config_hash to the session
-- snapshot idempotency key so re-syncing with a loosened read-time filter can
-- append newly-visible subjects without violating the existing uniqueness
-- contract.
--
-- Existing rows are backfilled to orientation = 'song' (the only orientation
-- that existed before this migration). All state/resolution renames and the
-- exactly-one-subject check are enforced AFTER backfill so no in-flight rows
-- are rejected.

-- ---------------------------------------------------------------------------
-- match_review_session
-- ---------------------------------------------------------------------------

-- orientation distinguishes independent song-mode vs playlist-mode passes so
-- switching modes does not destroy the other orientation's progress (MSR-06 C5).
ALTER TABLE public.match_review_session
  ADD COLUMN orientation TEXT NOT NULL DEFAULT 'song'
    CHECK (orientation IN ('song', 'playlist'));

-- The old index limited one active session per account regardless of orientation;
-- the new index allows one active session PER orientation (C5).
DROP INDEX IF EXISTS public.idx_match_review_session_one_active;

CREATE UNIQUE INDEX idx_match_review_session_one_active_per_orientation
  ON public.match_review_session (account_id, orientation)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- match_review_queue_item
-- ---------------------------------------------------------------------------

-- orientation column must exist before the exactly-one-subject check and before
-- dropping song_id NOT NULL, so existing rows get orientation='song' first.
ALTER TABLE public.match_review_queue_item
  ADD COLUMN orientation TEXT NOT NULL DEFAULT 'song'
    CHECK (orientation IN ('song', 'playlist'));

-- playlist_id is the review subject for playlist-mode items; NULL for song-mode.
ALTER TABLE public.match_review_queue_item
  ADD COLUMN playlist_id UUID REFERENCES playlist(id) ON DELETE CASCADE;

-- source_score was the internal name for the fit score used in queue ordering;
-- renamed to source_fit_score to match the domain vocabulary (B9/plan section 3.3).
ALTER TABLE public.match_review_queue_item
  RENAME COLUMN source_score TO source_fit_score;

-- visible_pairs_captured_at marks when the visible suggestion list was first
-- captured for this item; used by the capture RPC idempotency contract (C7).
ALTER TABLE public.match_review_queue_item
  ADD COLUMN visible_pairs_captured_at TIMESTAMPTZ;

-- song_id becomes nullable so playlist-mode items can exist without a song
-- subject. The exactly-one-subject constraint below enforces the invariant
-- structurally (C6).
ALTER TABLE public.match_review_queue_item
  ALTER COLUMN song_id DROP NOT NULL;

-- Drop the old state check before backfilling so the UPDATE to 'active' /
-- 'resolved' is not rejected by the pre-refactor constraint (B9).
ALTER TABLE public.match_review_queue_item
  DROP CONSTRAINT IF EXISTS match_review_queue_item_state_check;

-- Backfill state: 'presented' maps to the new 'active' lifecycle state;
-- 'completed', 'skipped', 'unavailable' all map to 'resolved' (B9).
UPDATE public.match_review_queue_item
  SET state = 'active'
  WHERE state = 'presented';

UPDATE public.match_review_queue_item
  SET state = 'resolved'
  WHERE state IN ('completed', 'skipped', 'unavailable');

-- Add the new lifecycle state constraint: state alone signals actionability
-- (pending/active) vs terminal (resolved); resolution carries the outcome (B9).
ALTER TABLE public.match_review_queue_item
  ADD CONSTRAINT match_review_queue_item_state_check
    CHECK (state IN ('pending', 'active', 'resolved'));

-- Make the NULL branch of resolution explicit; semantically equivalent to the
-- original but documents the two-column lifecycle model (B10).
ALTER TABLE public.match_review_queue_item
  DROP CONSTRAINT IF EXISTS match_review_queue_item_resolution_check,
  ADD CONSTRAINT match_review_queue_item_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('added', 'dismissed', 'skipped', 'unavailable'));

-- Exactly-one-subject: a song-mode item must have song_id set and no playlist_id;
-- a playlist-mode item must have playlist_id set and no song_id. Illegal or mixed
-- subject rows are rejected at write time (C6).
ALTER TABLE public.match_review_queue_item
  ADD CONSTRAINT match_review_queue_item_exactly_one_subject CHECK (
    (orientation = 'song'     AND song_id     IS NOT NULL AND playlist_id IS NULL) OR
    (orientation = 'playlist' AND playlist_id IS NOT NULL AND song_id     IS NULL)
  );

-- Drop old song-only uniqueness indexes that assumed song_id is always set;
-- they cannot protect playlist-mode rows because PostgreSQL unique indexes
-- allow multiple NULLs (plan section 3.3).
DROP INDEX IF EXISTS public.idx_match_review_queue_item_session_song;
DROP INDEX IF EXISTS public.idx_match_review_queue_item_session_snapshot_song;

-- Orientation-specific partial unique indexes replace the dropped indexes (C8).
-- Each index enforces one queue item per (session, subject) within its orientation.
CREATE UNIQUE INDEX idx_match_review_queue_item_session_song_subject
  ON public.match_review_queue_item (session_id, song_id)
  WHERE orientation = 'song';

CREATE UNIQUE INDEX idx_match_review_queue_item_session_playlist_subject
  ON public.match_review_queue_item (session_id, playlist_id)
  WHERE orientation = 'playlist';

-- Snapshot-scoped variants prevent double-enqueuing the same subject from the
-- same snapshot during idempotent append operations (C8).
CREATE UNIQUE INDEX idx_match_review_queue_item_session_snapshot_song_subject
  ON public.match_review_queue_item (session_id, source_snapshot_id, song_id)
  WHERE orientation = 'song';

CREATE UNIQUE INDEX idx_match_review_queue_item_session_snapshot_playlist_subject
  ON public.match_review_queue_item (session_id, source_snapshot_id, playlist_id)
  WHERE orientation = 'playlist';

-- ---------------------------------------------------------------------------
-- match_review_session_snapshot
-- ---------------------------------------------------------------------------

-- visibility_config_hash encodes the read-time filter settings used when deriving
-- queue subjects; including it in the PK allows the same snapshot to be re-applied
-- under a loosened filter without the old row blocking the upsert (C9).
ALTER TABLE public.match_review_session_snapshot
  ADD COLUMN visibility_config_hash TEXT NOT NULL DEFAULT 'legacy';

-- Expand the primary key to include visibility_config_hash so each
-- (session, snapshot, filter-config) combination is independently tracked.
ALTER TABLE public.match_review_session_snapshot
  DROP CONSTRAINT match_review_session_snapshot_pkey;

ALTER TABLE public.match_review_session_snapshot
  ADD PRIMARY KEY (session_id, snapshot_id, visibility_config_hash);
