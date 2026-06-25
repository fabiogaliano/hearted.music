-- MSR-07: Visible-pair capture table and event/decision context columns.
--
-- Three schema changes land together:
--
-- 1. match_review_item_visible_pair — captures the exact ordered suggestion list
--    the user saw for a queue item. Provides the visible_rank and fit_score
--    needed for position-bias correction in learning-to-rank (MSR-23 populates
--    this via capture RPC).
--
-- 2. match_event + match_decision column renames — the model rank and visible
--    rank were previously named served_rank / display_rank. The B5 terminology
--    decision renamed them to model_rank / visible_rank so both tables use
--    consistent vocabulary. served_orientation is added as nullable to record
--    which orientation was being served when the event/decision occurred (C14).
--
-- 3. The three atomic decision RPCs are updated to write model_rank instead of
--    served_rank, and to accept model_rank in the dismiss payload JSONB. The
--    external RPC parameter p_served_rank and return values are unchanged
--    (deferred to MSR-23 for the add RPC's full signature revision).

-- ---------------------------------------------------------------------------
-- 1. match_review_item_visible_pair (C11, C12-D, C13)
-- ---------------------------------------------------------------------------

CREATE TABLE public.match_review_item_visible_pair (
  -- Links to the queue item this visible list was captured for.
  queue_item_id UUID NOT NULL
    REFERENCES match_review_queue_item(id) ON DELETE CASCADE,
  -- The two sides of the ranked suggestion pair.
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  -- Denormalized for query locality without joining queue items.
  session_id UUID NOT NULL
    REFERENCES match_review_session(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  -- The snapshot this pair's scores came from.
  snapshot_id UUID REFERENCES match_snapshot(id),
  -- Which orientation was served (song = song-mode, playlist = playlist-mode).
  orientation TEXT NOT NULL CHECK (orientation IN ('song', 'playlist')),
  -- model_rank: pair's position in the snapshot/model ranking (match_result.rank
  -- or match_result_ranking.rank). Immutable once the snapshot was produced.
  model_rank INTEGER NOT NULL,
  -- visible_rank: dense position in the list the user actually saw after
  -- strictness filtering and prior-decision exclusion. 1-based, no gaps.
  -- Unique per queue item — enforced by the index below.
  visible_rank INTEGER NOT NULL,
  -- The score shown to the user (fit score after fused-score resolution).
  fit_score DOUBLE PRECISION NOT NULL,
  -- When capture_match_review_item_visible_pairs_atomic ran for this item.
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_item_id, song_id, playlist_id)
);

-- Unique visible rank per queue item — enforces the acceptance criterion that
-- no two pairs share the same visible position for one card.
CREATE UNIQUE INDEX idx_match_review_item_visible_pair_queue_visible_rank
  ON public.match_review_item_visible_pair (queue_item_id, visible_rank);

-- Efficient fetch of all captured pairs for a given account + queue item.
CREATE INDEX idx_match_review_item_visible_pair_account_queue
  ON public.match_review_item_visible_pair (account_id, queue_item_id);

ALTER TABLE public.match_review_item_visible_pair ENABLE ROW LEVEL SECURITY;

-- Deny direct access; all writes go through SECURITY DEFINER RPCs.
CREATE POLICY "match_review_item_visible_pair_deny_all"
  ON public.match_review_item_visible_pair FOR ALL USING (false);

REVOKE ALL ON TABLE public.match_review_item_visible_pair FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.match_review_item_visible_pair TO service_role;

-- ---------------------------------------------------------------------------
-- 2a. match_event column renames and new served_orientation column (B5, C14, C15-B)
-- ---------------------------------------------------------------------------

-- served_rank → model_rank: the pair's immutable model/snapshot rank.
ALTER TABLE public.match_event
  RENAME COLUMN served_rank TO model_rank;

-- display_rank → visible_rank: the dense position in the list the user saw.
ALTER TABLE public.match_event
  RENAME COLUMN display_rank TO visible_rank;

-- served_orientation: which orientation was active when the event was produced.
-- Nullable because direct-path (non-queue) decisions have no orientation context.
ALTER TABLE public.match_event
  ADD COLUMN served_orientation TEXT
    CHECK (served_orientation IN ('song', 'playlist'));

-- ---------------------------------------------------------------------------
-- 2b. match_decision column renames and new columns (B5, C14, C15-B)
-- ---------------------------------------------------------------------------

-- served_rank → model_rank: mirrors the rename on match_event.
ALTER TABLE public.match_decision
  RENAME COLUMN served_rank TO model_rank;

-- visible_rank: the dense position this pair held in the visible suggestion list
-- at decision time. Populated from captured visible pairs (MSR-23).
ALTER TABLE public.match_decision
  ADD COLUMN visible_rank INTEGER;

-- served_orientation: nullable for the same reason as match_event above.
ALTER TABLE public.match_decision
  ADD COLUMN served_orientation TEXT
    CHECK (served_orientation IN ('song', 'playlist'));

-- ---------------------------------------------------------------------------
-- 3. Update atomic decision RPCs to use the new column names
--    (model_rank replaces served_rank in column lists and dismiss payload)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_match_review_item_decision_atomic(
  p_item_id UUID,
  p_account_id UUID,
  p_playlist_id UUID,
  p_served_rank INTEGER DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.match_review_queue_item%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT *
  INTO v_item
  FROM public.match_review_queue_item
  WHERE id = p_item_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_item.state NOT IN ('pending', 'active') THEN
    RETURN 'already_resolved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.playlist playlist_row
    WHERE playlist_row.id = p_playlist_id
      AND playlist_row.account_id = p_account_id
  ) THEN
    RETURN 'foreign_playlist';
  END IF;

  IF COALESCE(public.is_account_song_entitled(p_account_id, v_item.song_id), FALSE) IS NOT TRUE THEN
    RETURN 'not_entitled';
  END IF;

  INSERT INTO public.match_decision (
    account_id,
    song_id,
    playlist_id,
    decision,
    decided_at,
    snapshot_id,
    model_rank,
    queue_item_id
  ) VALUES (
    p_account_id,
    v_item.song_id,
    p_playlist_id,
    'added',
    v_now,
    v_item.source_snapshot_id,
    p_served_rank,
    p_item_id
  )
  ON CONFLICT (account_id, song_id, playlist_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    decided_at = EXCLUDED.decided_at,
    snapshot_id = EXCLUDED.snapshot_id,
    model_rank = EXCLUDED.model_rank,
    queue_item_id = EXCLUDED.queue_item_id;

  INSERT INTO public.match_event (
    account_id,
    song_id,
    playlist_id,
    event,
    snapshot_id,
    model_rank,
    queue_item_id,
    session_id,
    occurred_at
  ) VALUES (
    p_account_id,
    v_item.song_id,
    p_playlist_id,
    'added',
    v_item.source_snapshot_id,
    p_served_rank,
    p_item_id,
    v_item.session_id,
    v_now
  );

  RETURN 'added';
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_match_review_item_atomic(
  p_item_id UUID,
  p_account_id UUID,
  p_decisions JSONB DEFAULT '[]'::JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.match_review_queue_item%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_decisions JSONB := COALESCE(p_decisions, '[]'::JSONB);
BEGIN
  IF jsonb_typeof(v_decisions) <> 'array' THEN
    RETURN 'invalid_input';
  END IF;

  SELECT *
  INTO v_item
  FROM public.match_review_queue_item
  WHERE id = p_item_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_item.state NOT IN ('pending', 'active') THEN
    RETURN 'already_resolved';
  END IF;

  UPDATE public.match_review_queue_item
  SET
    state = 'resolved',
    resolution = 'dismissed',
    resolved_at = v_now,
    updated_at = v_now
  WHERE id = v_item.id
    AND account_id = p_account_id;

  INSERT INTO public.match_decision (
    account_id,
    song_id,
    playlist_id,
    decision,
    decided_at,
    snapshot_id,
    model_rank,
    queue_item_id
  )
  SELECT
    p_account_id,
    v_item.song_id,
    decision_row.playlist_id,
    'dismissed',
    v_now,
    v_item.source_snapshot_id,
    decision_row.model_rank,
    p_item_id
  FROM jsonb_to_recordset(v_decisions) AS decision_row(
    playlist_id UUID,
    model_rank INTEGER
  )
  WHERE decision_row.playlist_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.playlist playlist_row
      WHERE playlist_row.id = decision_row.playlist_id
        AND playlist_row.account_id = p_account_id
    )
  ON CONFLICT (account_id, song_id, playlist_id) DO NOTHING;

  -- Mirror the dismissed decisions into the event log. The NOT EXISTS guard
  -- drops any pair that won a concurrent add race.
  INSERT INTO public.match_event (
    account_id,
    song_id,
    playlist_id,
    event,
    snapshot_id,
    model_rank,
    queue_item_id,
    session_id,
    occurred_at
  )
  SELECT
    p_account_id,
    v_item.song_id,
    decision_row.playlist_id,
    'dismissed',
    v_item.source_snapshot_id,
    decision_row.model_rank,
    p_item_id,
    v_item.session_id,
    v_now
  FROM jsonb_to_recordset(v_decisions) AS decision_row(
    playlist_id UUID,
    model_rank INTEGER
  )
  WHERE decision_row.playlist_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.playlist playlist_row
      WHERE playlist_row.id = decision_row.playlist_id
        AND playlist_row.account_id = p_account_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.match_decision md
      WHERE md.queue_item_id = p_item_id
        AND md.account_id = p_account_id
        AND md.playlist_id = decision_row.playlist_id
        AND md.decision = 'added'
    );

  RETURN 'dismissed';
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_match_review_item_atomic(
  p_item_id UUID,
  p_account_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.match_review_queue_item%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_add_count INTEGER := 0;
  v_strictness DOUBLE PRECISION;
BEGIN
  SELECT *
  INTO v_item
  FROM public.match_review_queue_item
  WHERE id = p_item_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_item.state NOT IN ('pending', 'active') THEN
    RETURN 'already_resolved';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_add_count
  FROM public.match_decision
  WHERE queue_item_id = p_item_id
    AND account_id = p_account_id
    AND decision = 'added';

  SELECT strictness_min_score
  INTO v_strictness
  FROM public.match_review_session
  WHERE id = v_item.session_id
    AND account_id = p_account_id;

  IF v_strictness IS NOT NULL THEN
    -- Log a 'skipped' event for every visible playlist the user neither added nor
    -- dismissed. mr.rank is the model rank (position-bias correction feature).
    INSERT INTO public.match_event (
      account_id,
      song_id,
      playlist_id,
      event,
      snapshot_id,
      model_rank,
      queue_item_id,
      session_id,
      occurred_at
    )
    SELECT
      p_account_id,
      v_item.song_id,
      mr.playlist_id,
      'skipped',
      v_item.source_snapshot_id,
      mr.rank,
      p_item_id,
      v_item.session_id,
      v_now
    FROM public.match_result mr
    WHERE mr.snapshot_id = v_item.source_snapshot_id
      AND mr.song_id = v_item.song_id
      AND mr.score >= v_strictness
      AND EXISTS (
        SELECT 1
        FROM public.playlist playlist_row
        WHERE playlist_row.id = mr.playlist_id
          AND playlist_row.account_id = p_account_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.match_decision md
        WHERE md.account_id = p_account_id
          AND md.song_id = v_item.song_id
          AND md.playlist_id = mr.playlist_id
      );
  END IF;

  IF v_add_count > 0 THEN
    UPDATE public.match_review_queue_item
    SET
      state = 'resolved',
      resolution = 'added',
      resolved_at = v_now,
      updated_at = v_now
    WHERE id = p_item_id
      AND account_id = p_account_id;

    RETURN 'completed_added';
  END IF;

  UPDATE public.match_review_queue_item
  SET
    state = 'resolved',
    resolution = 'skipped',
    resolved_at = v_now,
    updated_at = v_now
  WHERE id = p_item_id
    AND account_id = p_account_id;

  RETURN 'skipped';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, INTEGER)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID, JSONB)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, INTEGER)
TO service_role;

GRANT EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID, JSONB)
TO service_role;

GRANT EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
TO service_role;
