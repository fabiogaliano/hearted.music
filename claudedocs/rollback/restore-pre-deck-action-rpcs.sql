-- Rollback companion for the deck read model branch (review M13a).
--
-- NOT a supabase/migrations file — must NOT auto-apply. Reverting the app code
-- for this branch (git revert the merge commit, per plan §12/§15) does NOT
-- undo 20260706000009_extend_deck_action_rpcs.sql's CREATE OR REPLACE of the
-- four live action RPCs. Left in place, a reverted-to legacy caller would keep
-- bumping match_review_session.deck_revision and enqueueing
-- match_review_deck_job rows with no worker left running to drain them
-- (harmless but unbounded growth, and pointless writes on every action).
--
-- Run this script manually, by hand, immediately after reverting the app code
-- (or reverting the merge commit), to restore the four RPCs to their
-- pre-branch bodies. It is the exact inverse of 20260706000009: same function
-- signatures (CREATE OR REPLACE is safe, no DROP / return-type change), just
-- with the deck side effects (deck_revision bump + capture_ahead enqueue +
-- resume_position advance) removed.
--
-- Provenance (verified via `grep -rl <function-name> supabase/migrations/`,
-- taking the last definition strictly before 20260706000009):
--   add_match_review_item_decision_atomic          <- 20260627000200_msr_add_decision_xor_target.sql
--   dismiss_match_review_item_suggestion_atomic     <- 20260701140000_row_level_match_suggestion_dismiss.sql
--   finish_match_review_item_atomic                 <- 20260701140000_row_level_match_suggestion_dismiss.sql
--   dismiss_match_review_item_atomic                <- 20260701140000_row_level_match_suggestion_dismiss.sql
-- All four bodies below are copied verbatim from those two migrations
-- (including their REVOKE/GRANT blocks) — nothing was hand-reconstructed.

-- ===========================================================================
-- add-suggestion: add_match_review_item_decision_atomic
-- (pre-branch body: 20260627000200_msr_add_decision_xor_target.sql)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.add_match_review_item_decision_atomic(
  p_item_id              UUID,
  p_account_id           UUID,
  p_suggestion_song_id     UUID DEFAULT NULL,
  p_suggestion_playlist_id UUID DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item      public.match_review_queue_item%ROWTYPE;
  v_pair      public.match_review_item_visible_pair%ROWTYPE;
  v_now       TIMESTAMPTZ := now();
  v_song_id   UUID;
  v_playlist_id UUID;
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

  -- Exactly one suggestion side must be supplied (XOR). Supplying both — or
  -- neither — is ambiguous and rejected before the orientation branch so a
  -- mismatched extra ID can never be silently ignored.
  IF (p_suggestion_song_id IS NOT NULL AND p_suggestion_playlist_id IS NOT NULL)
     OR (p_suggestion_song_id IS NULL AND p_suggestion_playlist_id IS NULL) THEN
    RETURN 'invalid_target';
  END IF;

  -- Validate target shape matches the item's orientation: only the suggestion
  -- side should be supplied; supplying the subject side is an invalid call.
  IF v_item.orientation = 'song' THEN
    -- Song items: subject is song_id (from the item row). The suggestion must
    -- be a playlist. Callers must supply p_suggestion_playlist_id, not song.
    IF p_suggestion_playlist_id IS NULL THEN
      RETURN 'invalid_target';
    END IF;
  ELSE
    -- Playlist items: subject is playlist_id. The suggestion must be a song.
    IF p_suggestion_song_id IS NULL THEN
      RETURN 'invalid_target';
    END IF;
  END IF;

  -- Look up the captured visible pair for this exact (item, subject, suggestion)
  -- combination. The pair must have been captured by presentMatchReviewItem before
  -- the add mutation can succeed — this is the source of truth for ranks.
  IF v_item.orientation = 'song' THEN
    SELECT *
    INTO v_pair
    FROM public.match_review_item_visible_pair
    WHERE queue_item_id = p_item_id
      AND song_id       = v_item.song_id
      AND playlist_id   = p_suggestion_playlist_id;
  ELSE
    SELECT *
    INTO v_pair
    FROM public.match_review_item_visible_pair
    WHERE queue_item_id = p_item_id
      AND song_id       = p_suggestion_song_id
      AND playlist_id   = v_item.playlist_id;
  END IF;

  IF NOT FOUND THEN
    RETURN 'not_visible';
  END IF;

  -- Verify ownership and entitlement, orientation-aware. This fixes the MSR-06
  -- null-guard defect where the song-mode path checked `v_item.song_id` even for
  -- playlist items where that column is null.
  IF v_item.orientation = 'song' THEN
    -- The suggestion is the playlist; it must belong to the account.
    IF NOT EXISTS (
      SELECT 1 FROM public.playlist
      WHERE id = p_suggestion_playlist_id AND account_id = p_account_id
    ) THEN
      RETURN 'foreign_playlist';
    END IF;
    -- The subject song must be entitled.
    IF COALESCE(public.is_account_song_entitled(p_account_id, v_item.song_id), FALSE) IS NOT TRUE THEN
      RETURN 'not_entitled';
    END IF;
    v_song_id     := v_item.song_id;
    v_playlist_id := p_suggestion_playlist_id;
  ELSE
    -- The subject is the playlist; it must belong to the account.
    IF NOT EXISTS (
      SELECT 1 FROM public.playlist
      WHERE id = v_item.playlist_id AND account_id = p_account_id
    ) THEN
      RETURN 'foreign_playlist';
    END IF;
    -- The suggestion song must be entitled.
    IF COALESCE(public.is_account_song_entitled(p_account_id, p_suggestion_song_id), FALSE) IS NOT TRUE THEN
      RETURN 'not_entitled';
    END IF;
    v_song_id     := p_suggestion_song_id;
    v_playlist_id := v_item.playlist_id;
  END IF;

  -- Write the add decision using ranks from the captured visible pair. This
  -- ensures model_rank and visible_rank are always consistent with what the
  -- user actually saw, regardless of any subsequent snapshot changes.
  INSERT INTO public.match_decision (
    account_id,
    song_id,
    playlist_id,
    decision,
    decided_at,
    snapshot_id,
    model_rank,
    visible_rank,
    served_orientation,
    queue_item_id
  ) VALUES (
    p_account_id,
    v_song_id,
    v_playlist_id,
    'added',
    v_now,
    v_item.source_snapshot_id,
    v_pair.model_rank,
    v_pair.visible_rank,
    v_item.orientation,
    p_item_id
  )
  ON CONFLICT (account_id, song_id, playlist_id) DO UPDATE SET
    decision           = EXCLUDED.decision,
    decided_at         = EXCLUDED.decided_at,
    snapshot_id        = EXCLUDED.snapshot_id,
    model_rank         = EXCLUDED.model_rank,
    visible_rank       = EXCLUDED.visible_rank,
    served_orientation = EXCLUDED.served_orientation,
    queue_item_id      = EXCLUDED.queue_item_id;

  INSERT INTO public.match_event (
    account_id,
    song_id,
    playlist_id,
    event,
    snapshot_id,
    model_rank,
    visible_rank,
    served_orientation,
    queue_item_id,
    session_id,
    occurred_at
  ) VALUES (
    p_account_id,
    v_song_id,
    v_playlist_id,
    'added',
    v_item.source_snapshot_id,
    v_pair.model_rank,
    v_pair.visible_rank,
    v_item.orientation,
    p_item_id,
    v_item.session_id,
    v_now
  );

  RETURN 'added';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, UUID)
  TO service_role;

-- ===========================================================================
-- dismiss-suggestion: dismiss_match_review_item_suggestion_atomic
-- (pre-branch body: 20260701140000_row_level_match_suggestion_dismiss.sql)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.dismiss_match_review_item_suggestion_atomic(
  p_item_id                UUID,
  p_account_id             UUID,
  p_suggestion_song_id     UUID DEFAULT NULL,
  p_suggestion_playlist_id UUID DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item          public.match_review_queue_item%ROWTYPE;
  v_pair          public.match_review_item_visible_pair%ROWTYPE;
  v_now           TIMESTAMPTZ := now();
  v_song_id       UUID;
  v_playlist_id   UUID;
  v_written_count INTEGER;
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

  IF (p_suggestion_song_id IS NOT NULL AND p_suggestion_playlist_id IS NOT NULL)
     OR (p_suggestion_song_id IS NULL AND p_suggestion_playlist_id IS NULL) THEN
    RETURN 'invalid_target';
  END IF;

  IF v_item.orientation = 'song' THEN
    IF p_suggestion_playlist_id IS NULL THEN
      RETURN 'invalid_target';
    END IF;

    SELECT *
    INTO v_pair
    FROM public.match_review_item_visible_pair
    WHERE queue_item_id = p_item_id
      AND song_id       = v_item.song_id
      AND playlist_id   = p_suggestion_playlist_id;

    IF NOT FOUND THEN
      RETURN 'not_visible';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.playlist
      WHERE id = p_suggestion_playlist_id AND account_id = p_account_id
    ) THEN
      RETURN 'foreign_playlist';
    END IF;

    IF COALESCE(public.is_account_song_entitled(p_account_id, v_item.song_id), FALSE) IS NOT TRUE THEN
      RETURN 'not_entitled';
    END IF;

    v_song_id := v_item.song_id;
    v_playlist_id := p_suggestion_playlist_id;
  ELSE
    IF p_suggestion_song_id IS NULL THEN
      RETURN 'invalid_target';
    END IF;

    SELECT *
    INTO v_pair
    FROM public.match_review_item_visible_pair
    WHERE queue_item_id = p_item_id
      AND song_id       = p_suggestion_song_id
      AND playlist_id   = v_item.playlist_id;

    IF NOT FOUND THEN
      RETURN 'not_visible';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.playlist
      WHERE id = v_item.playlist_id AND account_id = p_account_id
    ) THEN
      RETURN 'foreign_playlist';
    END IF;

    IF COALESCE(public.is_account_song_entitled(p_account_id, p_suggestion_song_id), FALSE) IS NOT TRUE THEN
      RETURN 'not_entitled';
    END IF;

    v_song_id := p_suggestion_song_id;
    v_playlist_id := v_item.playlist_id;
  END IF;

  -- Idempotent retry: the row was already dismissed from this card.
  IF EXISTS (
    SELECT 1 FROM public.match_decision md
    WHERE md.queue_item_id = p_item_id
      AND md.account_id    = p_account_id
      AND md.song_id       = v_song_id
      AND md.playlist_id   = v_playlist_id
      AND md.decision      = 'dismissed'
  ) THEN
    RETURN 'dismissed';
  END IF;

  -- Added is stronger than dismiss. Never turn an add back into a rejection.
  IF EXISTS (
    SELECT 1 FROM public.match_decision md
    WHERE md.account_id  = p_account_id
      AND md.song_id     = v_song_id
      AND md.playlist_id = v_playlist_id
      AND md.decision    = 'added'
  ) THEN
    RETURN 'already_added';
  END IF;

  INSERT INTO public.match_decision (
    account_id,
    song_id,
    playlist_id,
    decision,
    decided_at,
    snapshot_id,
    model_rank,
    visible_rank,
    served_orientation,
    queue_item_id
  ) VALUES (
    p_account_id,
    v_song_id,
    v_playlist_id,
    'dismissed',
    v_now,
    v_item.source_snapshot_id,
    v_pair.model_rank,
    v_pair.visible_rank,
    v_item.orientation,
    p_item_id
  )
  ON CONFLICT (account_id, song_id, playlist_id) DO UPDATE SET
    decision           = EXCLUDED.decision,
    decided_at         = EXCLUDED.decided_at,
    snapshot_id        = EXCLUDED.snapshot_id,
    model_rank         = EXCLUDED.model_rank,
    visible_rank       = EXCLUDED.visible_rank,
    served_orientation = EXCLUDED.served_orientation,
    queue_item_id      = EXCLUDED.queue_item_id
  WHERE public.match_decision.decision <> 'added';

  GET DIAGNOSTICS v_written_count = ROW_COUNT;
  IF v_written_count = 0 THEN
    RETURN 'already_added';
  END IF;

  INSERT INTO public.match_event (
    account_id,
    song_id,
    playlist_id,
    event,
    snapshot_id,
    model_rank,
    visible_rank,
    served_orientation,
    queue_item_id,
    session_id,
    occurred_at
  ) VALUES (
    p_account_id,
    v_song_id,
    v_playlist_id,
    'dismissed',
    v_item.source_snapshot_id,
    v_pair.model_rank,
    v_pair.visible_rank,
    v_item.orientation,
    p_item_id,
    v_item.session_id,
    v_now
  );

  RETURN 'dismissed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_match_review_item_suggestion_atomic(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dismiss_match_review_item_suggestion_atomic(UUID, UUID, UUID, UUID)
  TO service_role;

-- ===========================================================================
-- finish-card: finish_match_review_item_atomic
-- (pre-branch body: 20260701140000_row_level_match_suggestion_dismiss.sql)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.finish_match_review_item_atomic(
  p_item_id    UUID,
  p_account_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        public.match_review_queue_item%ROWTYPE;
  v_now         TIMESTAMPTZ := now();
  v_add_count   INTEGER;
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

  IF v_item.visible_pairs_captured_at IS NULL THEN
    RETURN 'no_captured_pairs';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_add_count
  FROM public.match_decision
  WHERE queue_item_id = p_item_id
    AND account_id    = p_account_id
    AND decision      = 'added';

  IF v_add_count > 0 THEN
    UPDATE public.match_review_queue_item
    SET state = 'resolved', resolution = 'added', resolved_at = v_now, updated_at = v_now
    WHERE id = v_item.id AND account_id = p_account_id;
  ELSE
    UPDATE public.match_review_queue_item
    SET state = 'resolved', resolution = 'skipped', resolved_at = v_now, updated_at = v_now
    WHERE id = v_item.id AND account_id = p_account_id;
  END IF;

  IF v_item.orientation = 'song' THEN
    INSERT INTO public.match_event (
      account_id, song_id, playlist_id, event, snapshot_id, model_rank,
      visible_rank, served_orientation, queue_item_id, session_id, occurred_at
    )
    SELECT
      p_account_id, v_item.song_id, vp.playlist_id, 'skipped',
      v_item.source_snapshot_id, vp.model_rank, vp.visible_rank,
      v_item.orientation, p_item_id, v_item.session_id, v_now
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = v_item.song_id
          AND md.playlist_id   = vp.playlist_id
          AND md.decision      IN ('added', 'dismissed')
      );
  ELSE
    INSERT INTO public.match_event (
      account_id, song_id, playlist_id, event, snapshot_id, model_rank,
      visible_rank, served_orientation, queue_item_id, session_id, occurred_at
    )
    SELECT
      p_account_id, vp.song_id, v_item.playlist_id, 'skipped',
      v_item.source_snapshot_id, vp.model_rank, vp.visible_rank,
      v_item.orientation, p_item_id, v_item.session_id, v_now
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = vp.song_id
          AND md.playlist_id   = v_item.playlist_id
          AND md.decision      IN ('added', 'dismissed')
      );
  END IF;

  IF v_add_count > 0 THEN
    RETURN 'completed_added';
  END IF;
  RETURN 'skipped';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finish_match_review_item_atomic(UUID, UUID)
  TO service_role;

-- ===========================================================================
-- dismiss-card: dismiss_match_review_item_atomic
-- (pre-branch body: 20260701140000_row_level_match_suggestion_dismiss.sql)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.dismiss_match_review_item_atomic(
  p_item_id    UUID,
  p_account_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item  public.match_review_queue_item%ROWTYPE;
  v_now   TIMESTAMPTZ := now();
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

  IF v_item.visible_pairs_captured_at IS NULL THEN
    RETURN 'no_captured_pairs';
  END IF;

  UPDATE public.match_review_queue_item
  SET state = 'resolved', resolution = 'dismissed', resolved_at = v_now, updated_at = v_now
  WHERE id = v_item.id AND account_id = p_account_id;

  IF v_item.orientation = 'song' THEN
    INSERT INTO public.match_decision (
      account_id, song_id, playlist_id, decision, decided_at, snapshot_id,
      model_rank, visible_rank, served_orientation, queue_item_id
    )
    SELECT
      p_account_id, v_item.song_id, vp.playlist_id, 'dismissed', v_now,
      v_item.source_snapshot_id, vp.model_rank, vp.visible_rank,
      v_item.orientation, p_item_id
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = v_item.song_id
          AND md.playlist_id   = vp.playlist_id
          AND md.decision      IN ('added', 'dismissed')
      )
    ON CONFLICT (account_id, song_id, playlist_id) DO UPDATE SET
      decision           = EXCLUDED.decision,
      decided_at         = EXCLUDED.decided_at,
      snapshot_id        = EXCLUDED.snapshot_id,
      model_rank         = EXCLUDED.model_rank,
      visible_rank       = EXCLUDED.visible_rank,
      served_orientation = EXCLUDED.served_orientation,
      queue_item_id      = EXCLUDED.queue_item_id
    WHERE public.match_decision.decision <> 'added';

    INSERT INTO public.match_event (
      account_id, song_id, playlist_id, event, snapshot_id, model_rank,
      visible_rank, served_orientation, queue_item_id, session_id, occurred_at
    )
    SELECT
      p_account_id, v_item.song_id, vp.playlist_id, 'dismissed',
      v_item.source_snapshot_id, vp.model_rank, vp.visible_rank,
      v_item.orientation, p_item_id, v_item.session_id, v_now
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = v_item.song_id
          AND md.playlist_id   = vp.playlist_id
          AND md.decision      = 'dismissed'
          AND md.decided_at    = v_now
      );
  ELSE
    INSERT INTO public.match_decision (
      account_id, song_id, playlist_id, decision, decided_at, snapshot_id,
      model_rank, visible_rank, served_orientation, queue_item_id
    )
    SELECT
      p_account_id, vp.song_id, v_item.playlist_id, 'dismissed', v_now,
      v_item.source_snapshot_id, vp.model_rank, vp.visible_rank,
      v_item.orientation, p_item_id
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND NOT EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = vp.song_id
          AND md.playlist_id   = v_item.playlist_id
          AND md.decision      IN ('added', 'dismissed')
      )
    ON CONFLICT (account_id, song_id, playlist_id) DO UPDATE SET
      decision           = EXCLUDED.decision,
      decided_at         = EXCLUDED.decided_at,
      snapshot_id        = EXCLUDED.snapshot_id,
      model_rank         = EXCLUDED.model_rank,
      visible_rank       = EXCLUDED.visible_rank,
      served_orientation = EXCLUDED.served_orientation,
      queue_item_id      = EXCLUDED.queue_item_id
    WHERE public.match_decision.decision <> 'added';

    INSERT INTO public.match_event (
      account_id, song_id, playlist_id, event, snapshot_id, model_rank,
      visible_rank, served_orientation, queue_item_id, session_id, occurred_at
    )
    SELECT
      p_account_id, vp.song_id, v_item.playlist_id, 'dismissed',
      v_item.source_snapshot_id, vp.model_rank, vp.visible_rank,
      v_item.orientation, p_item_id, v_item.session_id, v_now
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id
      AND EXISTS (
        SELECT 1 FROM public.match_decision md
        WHERE md.queue_item_id = p_item_id
          AND md.account_id    = p_account_id
          AND md.song_id       = vp.song_id
          AND md.playlist_id   = v_item.playlist_id
          AND md.decision      = 'dismissed'
          AND md.decided_at    = v_now
      );
  END IF;

  RETURN 'dismissed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID)
  TO service_role;
