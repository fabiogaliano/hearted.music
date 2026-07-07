-- Deck read-model post-verification fix pass 3: supersede 20260707000018 by
-- adding a subject-count consistency guard to branch-2 promotion.
--
-- buildOneProposal is five non-transactional PostgREST calls (upsert
-- status='building'/total_subjects=0 → DELETE subjects → INSERT subjects →
-- INSERT seed pairs → UPDATE status='ready'/total_subjects=N). When a
-- request-path inline build and a worker build_proposals job race the same
-- (account, orientation, hash), one writer can flip the row 'ready' while the
-- other sits between its DELETE and re-INSERT, so a start_or_resume_match_deck
-- reader landing in that window could promote zero/partial subjects into a
-- durable session. The added predicate — p.total_subjects equals the live
-- subject row count — makes the branch-2 SELECT reject any 'ready' proposal
-- whose subject rows are mid-rewrite; the mismatch falls into the existing
-- BRANCH 3 miss, whose step-0 in-flight-job check defers to the running
-- worker and the client's bounded poll re-reads. 'ready' and total_subjects
-- are written in the same UPDATE, so a 'ready' row always carries its intended
-- count atomically, and the single SELECT sees one READ COMMITTED snapshot, so
-- the (status, count, subject rows) triple it observes is internally
-- consistent. Everything else is copied verbatim from 20260707000018.

CREATE OR REPLACE FUNCTION public.start_or_resume_match_deck(
  p_account_id            UUID,
  p_orientation           TEXT,
  p_visibility_config_hash TEXT,
  p_window                INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session      RECORD;
  v_created      BOOLEAN := false;
  v_latest_snap  UUID;
  v_proposal     RECORD;
  v_now          TIMESTAMPTZ := now();
  v_appended     INTEGER := 0;
  v_snapshot_id  UUID;
  v_vc_hash      TEXT;
  v_hidden       INTEGER := 0;
  v_total        BIGINT;
  v_remaining    BIGINT;
  v_item_ids     JSONB;
  v_cur_id       UUID;
  v_cur_pos      INTEGER;
  v_next_id      UUID;
  v_next_pos     INTEGER;
  v_current_card JSONB;
  v_next_card    JSONB;
  v_idem_key     TEXT;
BEGIN
  -- =========================================================================
  -- BRANCH 1: active session already exists for this (account, orientation).
  -- =========================================================================
  SELECT s.id, s.orientation, s.deck_revision, s.resume_position,
         s.active_proposal_id
  INTO v_session
  FROM public.match_review_session s
  WHERE s.account_id = p_account_id
    AND s.orientation = p_orientation
    AND s.status = 'active'
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- =======================================================================
    -- BRANCH 2 / 3: no active session. Look for a ready proposal to promote.
    -- =======================================================================
    SELECT ms.id
    INTO v_latest_snap
    FROM public.match_snapshot ms
    WHERE ms.account_id = p_account_id
    ORDER BY ms.created_at DESC
    LIMIT 1;

    -- No snapshot at all → miss (TS distinguishes this from "no ready proposal").
    IF v_latest_snap IS NULL THEN
      RETURN jsonb_build_object('status', 'miss', 'reason', 'no_ready_proposal');
    END IF;

    -- Only the LATEST snapshot's proposal for this hash may be promoted; an
    -- older snapshot's ready proposal is intentionally NOT used (plan §8).
    SELECT p.id, p.snapshot_id, p.visibility_config_hash,
           p.strictness_preset, p.strictness_min_score,
           p.total_subjects, p.hidden_review_item_count
    INTO v_proposal
    FROM public.match_review_proposal p
    WHERE p.account_id = p_account_id
      AND p.orientation = p_orientation
      AND p.snapshot_id = v_latest_snap
      AND p.visibility_config_hash = p_visibility_config_hash
      AND p.status = 'ready'
      AND p.total_subjects = (
        SELECT count(*) FROM public.match_review_proposal_subject ps
        WHERE ps.proposal_id = p.id
      )
    LIMIT 1;

    -- BRANCH 3: miss.
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'miss', 'reason', 'no_ready_proposal');
    END IF;

    -- ---------------------------------------------------------------------
    -- BRANCH 2: promote the proposal into a fresh active session.
    -- ---------------------------------------------------------------------
    -- The one-active-per-orientation partial unique index makes a concurrent
    -- promotion race raise unique_violation; the loser reads the winner's
    -- session and skips the (already-done) promotion steps, then returns the
    -- same active view.
    BEGIN
      INSERT INTO public.match_review_session (
        account_id, orientation, status,
        strictness_preset, strictness_min_score,
        active_proposal_id, deck_revision, resume_position
      ) VALUES (
        p_account_id, p_orientation, 'active',
        v_proposal.strictness_preset, v_proposal.strictness_min_score,
        v_proposal.id, 0, 0
      )
      RETURNING id, orientation, deck_revision, resume_position, active_proposal_id
      INTO v_session;
      v_created := true;
    EXCEPTION WHEN unique_violation THEN
      SELECT s.id, s.orientation, s.deck_revision, s.resume_position,
             s.active_proposal_id
      INTO v_session
      FROM public.match_review_session s
      WHERE s.account_id = p_account_id
        AND s.orientation = p_orientation
        AND s.status = 'active'
      ORDER BY s.created_at DESC
      LIMIT 1;
      v_created := false;
    END;

    IF v_created THEN
      -- Step 2: bulk INSERT … SELECT queue items from the proposal subjects.
      -- ON CONFLICT DO NOTHING (H3): a duplicate subject in the source table
      -- (should no longer happen post-20260706000012, but this is the
      -- suspenders half of belt-and-suspenders) must not abort the entry point.
      INSERT INTO public.match_review_queue_item (
        session_id, account_id, orientation,
        song_id, playlist_id, source_snapshot_id,
        position, state, source_fit_score, was_new_at_enqueue
      )
      SELECT
        v_session.id, p_account_id, ps.orientation,
        ps.song_id, ps.playlist_id, v_proposal.snapshot_id,
        ps.position, 'pending', ps.source_fit_score, ps.was_new_at_enqueue
      FROM public.match_review_proposal_subject ps
      WHERE ps.proposal_id = v_proposal.id
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_appended = ROW_COUNT;

      -- Step 3: copy the promotion seed into captured visible pairs for the
      -- first window, re-checking the dismissed exclusion in SQL (same pattern
      -- as read_match_deck_card / present_match_review_item_fast). Column set
      -- and first-write-wins semantics follow capture_match_review_item_visible_pairs_atomic.
      -- ON CONFLICT DO NOTHING (H3): same rationale as the queue-item insert above.
      INSERT INTO public.match_review_item_visible_pair (
        queue_item_id, song_id, playlist_id,
        session_id, account_id, snapshot_id, orientation,
        model_rank, visible_rank, fit_score, captured_at
      )
      SELECT
        qi.id, sp.song_id, sp.playlist_id,
        v_session.id, p_account_id, v_proposal.snapshot_id, qi.orientation,
        sp.model_rank, sp.visible_rank, sp.fit_score, v_now
      FROM public.match_review_proposal_seed_pair sp
      JOIN public.match_review_queue_item qi
        ON qi.session_id = v_session.id
       AND qi.position = sp.subject_position
      WHERE sp.proposal_id = v_proposal.id
        AND NOT EXISTS (
          SELECT 1
          FROM public.match_decision d
          WHERE d.account_id  = p_account_id
            AND d.song_id     = sp.song_id
            AND d.playlist_id = sp.playlist_id
            AND d.decision    = 'dismissed'
        )
      ON CONFLICT DO NOTHING;

      -- Stamp visible_pairs_captured_at + activate every seeded subject (even a
      -- subject whose pairs were all dismissed — a captured-empty card, matching
      -- the capture RPC's timestamp-and-activate semantics). Seeded positions are
      -- taken from the seed table so an all-dismissed subject still counts as
      -- captured.
      UPDATE public.match_review_queue_item qi
      SET visible_pairs_captured_at = v_now,
          state = CASE WHEN qi.state = 'pending' THEN 'active' ELSE qi.state END,
          updated_at = v_now
      WHERE qi.session_id = v_session.id
        AND qi.position IN (
          SELECT DISTINCT sp.subject_position
          FROM public.match_review_proposal_seed_pair sp
          WHERE sp.proposal_id = v_proposal.id
        );

      -- Step 4: snapshot ledger row, written exactly as appendSnapshotDelta does
      -- (session, snapshot, appended count, visibility hash).
      INSERT INTO public.match_review_session_snapshot (
        session_id, snapshot_id, appended_item_count, visibility_config_hash
      ) VALUES (
        v_session.id, v_proposal.snapshot_id, v_appended, p_visibility_config_hash
      );

      -- Step 5: enqueue a capture_ahead job. resume_position is 0 at promotion,
      -- so the idempotency key ends in ':0'. ON CONFLICT against the active-only
      -- partial unique index dedupes with any job already pending for this key.
      v_idem_key := 'capture:' || p_account_id::text || ':' || p_orientation
                    || ':' || v_session.id::text || ':0';
      INSERT INTO public.match_review_deck_job (
        account_id, orientation, session_id, kind, idempotency_key
      ) VALUES (
        p_account_id, p_orientation, v_session.id, 'capture_ahead', v_idem_key
      )
      ON CONFLICT (idempotency_key) WHERE status NOT IN ('completed', 'dead')
      DO NOTHING;
    END IF;
  END IF;

  -- =========================================================================
  -- SHARED: build the active MatchDeckView from v_session (branch 1, or the
  -- just-promoted / race-winner session from branch 2).
  -- =========================================================================

  -- snapshotId / visibilityConfigHash / hiddenReviewItemCount come from the
  -- active proposal when set; fall back to the ledger / the caller's hash / 0
  -- for legacy sessions created before the deck columns existed.
  IF v_session.active_proposal_id IS NOT NULL THEN
    SELECT p.snapshot_id, p.visibility_config_hash, p.hidden_review_item_count
    INTO v_snapshot_id, v_vc_hash, v_hidden
    FROM public.match_review_proposal p
    WHERE p.id = v_session.active_proposal_id;
  END IF;

  IF v_snapshot_id IS NULL THEN
    SELECT ss.snapshot_id
    INTO v_snapshot_id
    FROM public.match_review_session_snapshot ss
    WHERE ss.session_id = v_session.id
    ORDER BY ss.applied_at DESC
    LIMIT 1;
  END IF;

  IF v_vc_hash IS NULL THEN
    v_vc_hash := p_visibility_config_hash;
  END IF;

  IF v_hidden IS NULL THEN
    v_hidden := 0;
  END IF;

  -- Progress counts + ordered unresolved item ids over the session's items,
  -- in ONE SELECT (P1.4): a single scan of match_review_queue_item under one
  -- READ COMMITTED snapshot, so v_total/v_remaining/v_item_ids can never
  -- disagree with each other the way three independent SELECTs could under a
  -- concurrent write landing between them.
  SELECT
    count(*),
    count(*) FILTER (WHERE qi.state IN ('pending', 'active')),
    COALESCE(
      jsonb_agg(qi.id ORDER BY qi.position ASC)
        FILTER (WHERE qi.state IN ('pending', 'active')),
      '[]'::JSONB
    )
  INTO v_total, v_remaining, v_item_ids
  FROM public.match_review_queue_item qi
  WHERE qi.session_id = v_session.id;

  -- Current item: the first unresolved item at/after resume_position; when
  -- resume_position IS NULL (legacy, never positioned) the first unresolved item.
  SELECT qi.id, qi.position
  INTO v_cur_id, v_cur_pos
  FROM public.match_review_queue_item qi
  WHERE qi.session_id = v_session.id
    AND qi.state IN ('pending', 'active')
    AND (v_session.resume_position IS NULL OR qi.position >= v_session.resume_position)
  ORDER BY qi.position ASC
  LIMIT 1;

  IF v_cur_id IS NOT NULL THEN
    v_current_card := jsonb_build_object(
      'itemId', v_cur_id,
      'position', v_cur_pos,
      'presentation', public.read_match_deck_card(v_cur_id, p_account_id, p_window, true)
    );

    -- Next item: first unresolved item after the current one.
    SELECT qi.id, qi.position
    INTO v_next_id, v_next_pos
    FROM public.match_review_queue_item qi
    WHERE qi.session_id = v_session.id
      AND qi.state IN ('pending', 'active')
      AND qi.position > v_cur_pos
    ORDER BY qi.position ASC
    LIMIT 1;

    IF v_next_id IS NOT NULL THEN
      v_next_card := jsonb_build_object(
        'itemId', v_next_id,
        'position', v_next_pos,
        'presentation', public.read_match_deck_card(v_next_id, p_account_id, p_window, false)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'active',
    'version', 1,
    'accountId', p_account_id,
    'orientation', v_session.orientation,
    'sessionId', v_session.id,
    'snapshotId', v_snapshot_id,
    'visibilityConfigHash', v_vc_hash,
    'revision', v_session.deck_revision,
    'progress', jsonb_build_object(
      'total', v_total,
      'remaining', v_remaining,
      'caughtUp', (v_remaining = 0),
      'hiddenReviewItemCount', v_hidden
    ),
    'itemIds', v_item_ids,
    'cards', jsonb_build_object(
      'current', v_current_card,
      'next', v_next_card
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_or_resume_match_deck(UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_or_resume_match_deck(UUID, TEXT, TEXT, INTEGER)
  TO service_role;
