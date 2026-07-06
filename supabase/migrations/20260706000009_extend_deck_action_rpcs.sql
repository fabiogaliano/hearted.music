-- Match deck read model, Phase 1b (plan §9): deck side effects on action RPCs.
--
-- Extends the four atomic decision RPCs so that, in the SAME transaction as the
-- decision, they also maintain deck state:
--   * ALL FOUR bump match_review_session.deck_revision and enqueue a
--     capture_ahead match_review_deck_job (ON CONFLICT DO NOTHING against the
--     active-only idempotency index), so repeated suggestion-level actions on the
--     same card dedupe to one pending job. This reconciles the brief's "all 4"
--     with §9's "whole-card actions advance the deck": revision + capture job are
--     universal; only whole-card actions advance resume_position.
--   * WHOLE-CARD actions (finish-card, dismiss-card) additionally advance
--     resume_position to the next unresolved item's position (or one past the
--     last item when the deck is caught up — the "past the end" sentinel).
--
-- RETURN SHAPE UNCHANGED (deliberate): the four RPCs KEEP their existing
-- `RETURNS TEXT` signature and their exact status strings, so every current
-- caller in src/lib/domains/taste/match-review-queue/queries.ts and the live
-- match-event-log integration test keep working through Phases 1b–2 untouched.
-- The rich JSONB return (deck_revision / progress / next_card, which would
-- require a TEXT→JSONB return-type change) is DEFERRED to Phase 3, where it
-- lands atomically with submitMatchDeckAction and its caller updates. The deck
-- side effects added here are pure writes, independent of the return value, so
-- CREATE OR REPLACE is safe (no DROP / return-type change) and no RPC calls
-- read_match_deck_card.
--
-- dismiss-CARD vs dismiss-SUGGESTION (confirmed by reading the two dismiss
-- migrations): dismiss_match_review_item_atomic is dismiss-CARD (whole-card, deck
-- advance); dismiss_match_review_item_suggestion_atomic (row-level, 20260701140000)
-- is dismiss-SUGGESTION (revision + job, NO advance).
--
-- Bodies below preserve the LATEST decision/event logic verbatim: add =
-- 20260627000200 (XOR target guard); finish, dismiss-card, dismiss-suggestion =
-- 20260701140000 (row-dismiss-aware exclusions). Only the injected deck side
-- effects are new; every RETURN keeps its original TEXT status string.

-- ===========================================================================
-- add-suggestion: add_match_review_item_decision_atomic (suggestion-level)
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
  v_item        public.match_review_queue_item%ROWTYPE;
  v_pair        public.match_review_item_visible_pair%ROWTYPE;
  v_now         TIMESTAMPTZ := now();
  v_song_id     UUID;
  v_playlist_id UUID;
  v_resume_after INTEGER;
  v_idem_key     TEXT;
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
  -- neither — is ambiguous and rejected before the orientation branch.
  IF (p_suggestion_song_id IS NOT NULL AND p_suggestion_playlist_id IS NOT NULL)
     OR (p_suggestion_song_id IS NULL AND p_suggestion_playlist_id IS NULL) THEN
    RETURN 'invalid_target';
  END IF;

  IF v_item.orientation = 'song' THEN
    IF p_suggestion_playlist_id IS NULL THEN
      RETURN 'invalid_target';
    END IF;
  ELSE
    IF p_suggestion_song_id IS NULL THEN
      RETURN 'invalid_target';
    END IF;
  END IF;

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

  IF v_item.orientation = 'song' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.playlist
      WHERE id = p_suggestion_playlist_id AND account_id = p_account_id
    ) THEN
      RETURN 'foreign_playlist';
    END IF;
    IF COALESCE(public.is_account_song_entitled(p_account_id, v_item.song_id), FALSE) IS NOT TRUE THEN
      RETURN 'not_entitled';
    END IF;
    v_song_id     := v_item.song_id;
    v_playlist_id := p_suggestion_playlist_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.playlist
      WHERE id = v_item.playlist_id AND account_id = p_account_id
    ) THEN
      RETURN 'foreign_playlist';
    END IF;
    IF COALESCE(public.is_account_song_entitled(p_account_id, p_suggestion_song_id), FALSE) IS NOT TRUE THEN
      RETURN 'not_entitled';
    END IF;
    v_song_id     := p_suggestion_song_id;
    v_playlist_id := v_item.playlist_id;
  END IF;

  INSERT INTO public.match_decision (
    account_id, song_id, playlist_id, decision, decided_at,
    snapshot_id, model_rank, visible_rank, served_orientation, queue_item_id
  ) VALUES (
    p_account_id, v_song_id, v_playlist_id, 'added', v_now,
    v_item.source_snapshot_id, v_pair.model_rank, v_pair.visible_rank,
    v_item.orientation, p_item_id
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
    account_id, song_id, playlist_id, event, snapshot_id, model_rank,
    visible_rank, served_orientation, queue_item_id, session_id, occurred_at
  ) VALUES (
    p_account_id, v_song_id, v_playlist_id, 'added',
    v_item.source_snapshot_id, v_pair.model_rank, v_pair.visible_rank,
    v_item.orientation, p_item_id, v_item.session_id, v_now
  );

  -- Deck side effect (suggestion-level): bump revision, enqueue capture_ahead.
  -- The card stays current, so resume_position is unchanged and the idempotency
  -- key reuses it — repeated adds on this card dedupe to one pending job.
  UPDATE public.match_review_session
  SET deck_revision = deck_revision + 1,
      updated_at = v_now
  WHERE id = v_item.session_id
  RETURNING resume_position INTO v_resume_after;

  v_idem_key := 'capture:' || v_item.account_id::text || ':' || v_item.orientation
                || ':' || v_item.session_id::text || ':' || COALESCE(v_resume_after::text, 'none');
  INSERT INTO public.match_review_deck_job (
    account_id, orientation, session_id, kind, idempotency_key
  ) VALUES (
    v_item.account_id, v_item.orientation, v_item.session_id, 'capture_ahead', v_idem_key
  )
  ON CONFLICT (idempotency_key) WHERE status NOT IN ('completed', 'dead')
  DO NOTHING;

  RETURN 'added';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_match_review_item_decision_atomic(UUID, UUID, UUID, UUID)
  TO service_role;

-- ===========================================================================
-- dismiss-suggestion: dismiss_match_review_item_suggestion_atomic (row-level)
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
  v_resume_after  INTEGER;
  v_idem_key      TEXT;
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
    account_id, song_id, playlist_id, decision, decided_at,
    snapshot_id, model_rank, visible_rank, served_orientation, queue_item_id
  ) VALUES (
    p_account_id, v_song_id, v_playlist_id, 'dismissed', v_now,
    v_item.source_snapshot_id, v_pair.model_rank, v_pair.visible_rank,
    v_item.orientation, p_item_id
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
    account_id, song_id, playlist_id, event, snapshot_id, model_rank,
    visible_rank, served_orientation, queue_item_id, session_id, occurred_at
  ) VALUES (
    p_account_id, v_song_id, v_playlist_id, 'dismissed',
    v_item.source_snapshot_id, v_pair.model_rank, v_pair.visible_rank,
    v_item.orientation, p_item_id, v_item.session_id, v_now
  );

  -- Deck side effect (suggestion-level): a suggestion was removed from the
  -- current card, so bump revision and enqueue capture_ahead; the card stays
  -- current so resume_position is unchanged.
  UPDATE public.match_review_session
  SET deck_revision = deck_revision + 1,
      updated_at = v_now
  WHERE id = v_item.session_id
  RETURNING resume_position INTO v_resume_after;

  v_idem_key := 'capture:' || v_item.account_id::text || ':' || v_item.orientation
                || ':' || v_item.session_id::text || ':' || COALESCE(v_resume_after::text, 'none');
  INSERT INTO public.match_review_deck_job (
    account_id, orientation, session_id, kind, idempotency_key
  ) VALUES (
    v_item.account_id, v_item.orientation, v_item.session_id, 'capture_ahead', v_idem_key
  )
  ON CONFLICT (idempotency_key) WHERE status NOT IN ('completed', 'dead')
  DO NOTHING;

  RETURN 'dismissed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_match_review_item_suggestion_atomic(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_match_review_item_suggestion_atomic(UUID, UUID, UUID, UUID)
  TO service_role;

-- ===========================================================================
-- finish-card: finish_match_review_item_atomic (whole-card)
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
  v_item         public.match_review_queue_item%ROWTYPE;
  v_now          TIMESTAMPTZ := now();
  v_add_count    INTEGER;
  v_resume_after INTEGER;
  v_idem_key     TEXT;
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

  -- Deck advance (whole-card): resume_position moves to the next unresolved item
  -- after this one, or one past the last item when caught up. Revision bumps and
  -- a capture_ahead job is enqueued for the promoted position.
  SELECT min(qi.position)
  INTO v_resume_after
  FROM public.match_review_queue_item qi
  WHERE qi.session_id = v_item.session_id
    AND qi.state IN ('pending', 'active')
    AND qi.position > v_item.position;

  IF v_resume_after IS NULL THEN
    SELECT COALESCE(max(qi.position), v_item.position) + 1
    INTO v_resume_after
    FROM public.match_review_queue_item qi
    WHERE qi.session_id = v_item.session_id;
  END IF;

  UPDATE public.match_review_session
  SET deck_revision = deck_revision + 1,
      resume_position = v_resume_after,
      updated_at = v_now
  WHERE id = v_item.session_id;

  v_idem_key := 'capture:' || v_item.account_id::text || ':' || v_item.orientation
                || ':' || v_item.session_id::text || ':' || v_resume_after::text;
  INSERT INTO public.match_review_deck_job (
    account_id, orientation, session_id, kind, idempotency_key
  ) VALUES (
    v_item.account_id, v_item.orientation, v_item.session_id, 'capture_ahead', v_idem_key
  )
  ON CONFLICT (idempotency_key) WHERE status NOT IN ('completed', 'dead')
  DO NOTHING;

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
-- dismiss-card: dismiss_match_review_item_atomic (whole-card)
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
  v_item         public.match_review_queue_item%ROWTYPE;
  v_now          TIMESTAMPTZ := now();
  v_resume_after INTEGER;
  v_idem_key     TEXT;
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

  -- Deck advance (whole-card): identical convention to finish-card.
  SELECT min(qi.position)
  INTO v_resume_after
  FROM public.match_review_queue_item qi
  WHERE qi.session_id = v_item.session_id
    AND qi.state IN ('pending', 'active')
    AND qi.position > v_item.position;

  IF v_resume_after IS NULL THEN
    SELECT COALESCE(max(qi.position), v_item.position) + 1
    INTO v_resume_after
    FROM public.match_review_queue_item qi
    WHERE qi.session_id = v_item.session_id;
  END IF;

  UPDATE public.match_review_session
  SET deck_revision = deck_revision + 1,
      resume_position = v_resume_after,
      updated_at = v_now
  WHERE id = v_item.session_id;

  v_idem_key := 'capture:' || v_item.account_id::text || ':' || v_item.orientation
                || ':' || v_item.session_id::text || ':' || v_resume_after::text;
  INSERT INTO public.match_review_deck_job (
    account_id, orientation, session_id, kind, idempotency_key
  ) VALUES (
    v_item.account_id, v_item.orientation, v_item.session_id, 'capture_ahead', v_idem_key
  )
  ON CONFLICT (idempotency_key) WHERE status NOT IN ('completed', 'dead')
  DO NOTHING;

  RETURN 'dismissed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_match_review_item_atomic(UUID, UUID)
  TO service_role;
