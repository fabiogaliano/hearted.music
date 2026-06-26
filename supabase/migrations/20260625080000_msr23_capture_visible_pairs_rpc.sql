-- MSR-23: capture_match_review_item_visible_pairs_atomic RPC.
--
-- Implements atomic first-presentation capture so retries and multi-tab races
-- return the original visible ranks rather than inserting duplicate rows.
--
-- Statuses (B11-A):
--   captured       — pairs inserted, item activated, timestamp set.
--   already_captured — item already had visible pairs; returns original rows.
--   empty          — zero pairs given; timestamp + activation still applied.
--   not_found      — no queue item matching (p_item_id, p_account_id).
--   already_resolved — item is in the resolved state; capture is a no-op.
--   invalid_input  — JSON shape invalid, non-dense visible ranks, or subject
--                    mismatch.
--
-- Return type is JSONB so the idempotent path can return both a status and the
-- existing pair rows in the same response without a separate round-trip.

CREATE OR REPLACE FUNCTION public.capture_match_review_item_visible_pairs_atomic(
  p_item_id   UUID,
  p_account_id UUID,
  p_pairs     JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item       public.match_review_queue_item%ROWTYPE;
  v_now        TIMESTAMPTZ := now();
  v_pair_count INTEGER;
  v_rank_min   INTEGER;
  v_rank_max   INTEGER;
  v_rank_dist  BIGINT;
  v_existing   JSONB;
BEGIN
  -- JSON shape: must be a non-null array.
  IF p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input',
                              'reason', 'p_pairs must be a JSON array');
  END IF;

  v_pair_count := jsonb_array_length(p_pairs);

  IF v_pair_count > 0 THEN
    -- Field-presence validation: every element must have the five required keys
    -- with the right types.  A single missing or NULL field is invalid_input.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_pairs) AS elem
      WHERE
        elem->>'song_id'     IS NULL OR
        elem->>'playlist_id' IS NULL OR
        elem->>'model_rank'  IS NULL OR
        elem->>'visible_rank' IS NULL OR
        elem->>'fit_score'   IS NULL
    ) THEN
      RETURN jsonb_build_object('status', 'invalid_input',
                                'reason', 'pair missing required fields');
    END IF;

    -- Numeric type validation: cast failures are caught and returned as
    -- invalid_input rather than propagating a Postgres error.
    BEGIN
      PERFORM
        (elem->>'song_id')::UUID,
        (elem->>'playlist_id')::UUID,
        (elem->>'model_rank')::INTEGER,
        (elem->>'visible_rank')::INTEGER,
        (elem->>'fit_score')::DOUBLE PRECISION
      FROM jsonb_array_elements(p_pairs) AS elem;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('status', 'invalid_input',
                                'reason', 'pair field type mismatch');
    END;

    -- Dense visible_rank check: all N values must be distinct, min = 1, max = N.
    -- That is equivalent to the set {1, 2, …, N} being present exactly once.
    SELECT
      MIN((elem->>'visible_rank')::INTEGER),
      MAX((elem->>'visible_rank')::INTEGER),
      COUNT(DISTINCT (elem->>'visible_rank')::INTEGER)
    INTO v_rank_min, v_rank_max, v_rank_dist
    FROM jsonb_array_elements(p_pairs) AS elem;

    IF v_rank_min <> 1
       OR v_rank_max <> v_pair_count
       OR v_rank_dist <> v_pair_count THEN
      RETURN jsonb_build_object('status', 'invalid_input',
                                'reason', 'visible_rank must be dense 1..N with no duplicates');
    END IF;
  END IF;

  -- Lock the queue item row so concurrent captures for the same item are
  -- serialised and the first one wins (FOR UPDATE takes the row-level lock).
  SELECT *
  INTO v_item
  FROM public.match_review_queue_item
  WHERE id          = p_item_id
    AND account_id  = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_item.state = 'resolved' THEN
    RETURN jsonb_build_object('status', 'already_resolved');
  END IF;

  -- Idempotency: if this item was already captured (by a prior call or a
  -- concurrent transaction that won the lock race), return the original rows
  -- ordered by visible_rank rather than inserting duplicates.
  IF v_item.visible_pairs_captured_at IS NOT NULL THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'song_id',      vp.song_id,
        'playlist_id',  vp.playlist_id,
        'model_rank',   vp.model_rank,
        'visible_rank', vp.visible_rank,
        'fit_score',    vp.fit_score
      ) ORDER BY vp.visible_rank
    )
    INTO v_existing
    FROM public.match_review_item_visible_pair vp
    WHERE vp.queue_item_id = p_item_id;

    RETURN jsonb_build_object(
      'status', 'already_captured',
      'pairs',  COALESCE(v_existing, '[]'::JSONB)
    );
  END IF;

  -- Subject consistency: every pair must carry the same subject-side ID as the
  -- queue item so callers cannot silently capture pairs for a different item.
  IF v_pair_count > 0 THEN
    IF v_item.orientation = 'song' THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_pairs) AS elem
        WHERE (elem->>'song_id')::UUID <> v_item.song_id
      ) THEN
        RETURN jsonb_build_object('status', 'invalid_input',
                                  'reason', 'song_id mismatch for song-orientation item');
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_pairs) AS elem
        WHERE (elem->>'playlist_id')::UUID <> v_item.playlist_id
      ) THEN
        RETURN jsonb_build_object('status', 'invalid_input',
                                  'reason', 'playlist_id mismatch for playlist-orientation item');
      END IF;
    END IF;
  END IF;

  -- Insert visible pairs.  The composite PK (queue_item_id, song_id, playlist_id)
  -- provides a secondary guard against duplicate pairs within the same call.
  IF v_pair_count > 0 THEN
    INSERT INTO public.match_review_item_visible_pair (
      queue_item_id,
      song_id,
      playlist_id,
      session_id,
      account_id,
      snapshot_id,
      orientation,
      model_rank,
      visible_rank,
      fit_score,
      captured_at
    )
    SELECT
      p_item_id,
      (elem->>'song_id')::UUID,
      (elem->>'playlist_id')::UUID,
      v_item.session_id,
      p_account_id,
      v_item.source_snapshot_id,
      v_item.orientation,
      (elem->>'model_rank')::INTEGER,
      (elem->>'visible_rank')::INTEGER,
      (elem->>'fit_score')::DOUBLE PRECISION,
      v_now
    FROM jsonb_array_elements(p_pairs) AS elem;
  END IF;

  -- Stamp the capture timestamp and activate the item in the same transaction.
  -- CASE avoids demoting an already-active item back to active (no-op for active).
  UPDATE public.match_review_queue_item
  SET
    visible_pairs_captured_at = v_now,
    state      = CASE WHEN state = 'pending' THEN 'active' ELSE state END,
    updated_at = v_now
  WHERE id         = p_item_id
    AND account_id = p_account_id;

  IF v_pair_count = 0 THEN
    RETURN jsonb_build_object('status', 'empty');
  END IF;

  RETURN jsonb_build_object('status', 'captured');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.capture_match_review_item_visible_pairs_atomic(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.capture_match_review_item_visible_pairs_atomic(UUID, UUID, JSONB)
  TO service_role;
