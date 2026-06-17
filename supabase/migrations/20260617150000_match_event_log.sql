-- Append-only interaction log for the /match review flow.
--
-- match_decision models CURRENT STATE: last-write-wins, unique per
-- (account, song, playlist), and the source of the matching exclusion set. It
-- deliberately never records skips (its CHECK allows only 'added'/'dismissed'),
-- so the highest-volume signal in /match — the user skipping a card — is lost.
--
-- match_event is the sibling that models EVENT HISTORY: one row per
-- (song, playlist) outcome the user produced, including skips. It is append-only
-- (no unique constraint) so repeated encounters across passes accumulate as
-- distinct events, and it never feeds the exclusion set, so logging a skip here
-- does NOT stop a song from resurfacing later (a user can still come back to it).
-- This is the training substrate for a future learning-to-rank model: it keeps
-- the served context (snapshot + rank) needed to correct for position bias, and
-- labels can be re-weighted at training time (add > dismiss > skip).
--
-- SCOPE: match_event is the queue /match INTERACTION log, not a universal
-- add-history. Only the three /match queue RPCs below append to it, so every row
-- carries a served slate (snapshot, rank, session, queue item). The legacy/direct
-- "add to playlist" path (addSongToPlaylist, used outside /match) deliberately
-- does NOT emit events: those adds have no review session or served ranking, so
-- they'd be contextless rows that pollute the position-bias features. They still
-- write match_decision (current state) as before. If a future model needs all add
-- actions, surface those non-queue adds as a separate, explicitly-contextless
-- signal rather than back-filling them here.

CREATE TABLE public.match_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('added', 'dismissed', 'skipped')),
  -- The snapshot the user was looking at. Join match_result on
  -- (snapshot_id, song_id, playlist_id) to recover the immutable per-factor
  -- scores that explained the suggestion at decision time.
  snapshot_id UUID REFERENCES match_snapshot(id),
  -- The MODEL rank: the pair's position in the snapshot ranking
  -- (match_result.rank). NULL = below the served slate (an implicit negative).
  -- This is the immutable, well-defined ordering the scorer produced — NOT what
  -- the user actually saw, which is filtered (strictness bar, prior decisions,
  -- missing playlists) and re-sorted client-side.
  served_rank INTEGER,
  -- The DISPLAY rank: the pair's dense position in the slate the user actually
  -- saw. Distinct from served_rank because the UI filters and re-sorts before
  -- render, and that visible position is what inverse-propensity / position-bias
  -- correction in learning-to-rank needs. NULL until presentation-slate capture
  -- exists (the visible slate isn't reconstructable in SQL — it depends on
  -- client-side filtering/sort), so this stays unwired for now and is populated
  -- once markMatchReviewItemPresented persists the shown slate. Keeping both ranks
  -- (model + display) lets training use the model rank as a feature too.
  display_rank INTEGER,
  -- The queue item this event came from; groups one card's events together.
  queue_item_id UUID REFERENCES match_review_queue_item(id),
  -- The review session, so events can be grouped into an impression slate.
  session_id UUID REFERENCES match_review_session(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_event_account ON public.match_event(account_id);
CREATE INDEX idx_match_event_account_song ON public.match_event(account_id, song_id);
CREATE INDEX idx_match_event_snapshot ON public.match_event(snapshot_id);
CREATE INDEX idx_match_event_queue_item ON public.match_event(queue_item_id)
  WHERE queue_item_id IS NOT NULL;
-- playlist_id FK is ON DELETE CASCADE; a user deleting a playlist would
-- otherwise scan this append-only (fast-growing) log to find rows to remove.
CREATE INDEX idx_match_event_playlist ON public.match_event(playlist_id);

ALTER TABLE public.match_event ENABLE ROW LEVEL SECURITY;

-- Deny direct access; all writes go through the SECURITY DEFINER RPCs below,
-- read access is service_role only. Matches every other table's convention.
CREATE POLICY "match_event_deny_all" ON public.match_event FOR ALL USING (false);

-- ============================================================================
-- Re-define the three atomic decision RPCs to also append to match_event.
-- Signatures are unchanged, so the TS callers and their tests are untouched.
-- Each event is written inside the same locked transaction as the decision /
-- resolution it describes, so the signal log can never drift from queue state.
-- ============================================================================

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

  IF v_item.state NOT IN ('pending', 'presented') THEN
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
    served_rank,
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
    served_rank = EXCLUDED.served_rank,
    queue_item_id = EXCLUDED.queue_item_id;

  -- One 'added' event per add action. Playlist ownership/entitlement were just
  -- verified above, so the FK is safe.
  INSERT INTO public.match_event (
    account_id,
    song_id,
    playlist_id,
    event,
    snapshot_id,
    served_rank,
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

  IF v_item.state NOT IN ('pending', 'presented') THEN
    RETURN 'already_resolved';
  END IF;

  UPDATE public.match_review_queue_item
  SET
    state = 'completed',
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
    served_rank,
    queue_item_id
  )
  SELECT
    p_account_id,
    v_item.song_id,
    decision_row.playlist_id,
    'dismissed',
    v_now,
    v_item.source_snapshot_id,
    decision_row.served_rank,
    p_item_id
  FROM jsonb_to_recordset(v_decisions) AS decision_row(
    playlist_id UUID,
    served_rank INTEGER
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
  -- drops any pair that won a concurrent add race, so match_event never holds
  -- both an 'added' and a 'dismissed' event for the same card+playlist.
  INSERT INTO public.match_event (
    account_id,
    song_id,
    playlist_id,
    event,
    snapshot_id,
    served_rank,
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
    decision_row.served_rank,
    p_item_id,
    v_item.session_id,
    v_now
  FROM jsonb_to_recordset(v_decisions) AS decision_row(
    playlist_id UUID,
    served_rank INTEGER
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

  IF v_item.state NOT IN ('pending', 'presented') THEN
    RETURN 'already_resolved';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_add_count
  FROM public.match_decision
  WHERE queue_item_id = p_item_id
    AND account_id = p_account_id
    AND decision = 'added';

  -- Log skip signal: every playlist that was visible on this card (scored at or
  -- above the session's strictness bar) but was NOT added is a "shown, not
  -- chosen" negative. This runs for both resolutions — a card finished with some
  -- adds still skipped the playlists left untouched (the NOT EXISTS drops the
  -- added ones). Derived here in SQL rather than passed from the server so finish
  -- keeps its 2-arg signature and the derivation is atomic under the queue-row
  -- lock. match_result.rank is the served position needed to debias by rank, and
  -- the playlist EXISTS guard keeps a concurrently-deleted playlist from rolling
  -- back the resolve. Best-effort: a missing session row logs nothing rather than
  -- blocking the card from finishing.
  SELECT strictness_min_score
  INTO v_strictness
  FROM public.match_review_session
  WHERE id = v_item.session_id
    AND account_id = p_account_id;

  IF v_strictness IS NOT NULL THEN
    INSERT INTO public.match_event (
      account_id,
      song_id,
      playlist_id,
      event,
      snapshot_id,
      served_rank,
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
      state = 'completed',
      resolution = 'added',
      resolved_at = v_now,
      updated_at = v_now
    WHERE id = p_item_id
      AND account_id = p_account_id;

    RETURN 'completed_added';
  END IF;

  UPDATE public.match_review_queue_item
  SET
    state = 'skipped',
    resolution = 'skipped',
    resolved_at = v_now,
    updated_at = v_now
  WHERE id = p_item_id
    AND account_id = p_account_id;

  RETURN 'skipped';
END;
$$;
