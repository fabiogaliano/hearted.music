-- Parameterize grant_liked_song_access with a configurable snapshot size.
--
-- The benefit previously unlocked a hardcoded top 500 active liked songs. The
-- operator console needs to grant custom amounts (support escalations, larger
-- VIP grants), so the cap becomes p_limit with a DEFAULT of 500 — the automatic
-- waitlist path and every existing caller keep their original behaviour without
-- passing the new argument. The value is clamped to [1, 10000] so a bad operator
-- input can neither unlock zero songs nor snapshot an unbounded set.
--
-- Adding a defaulted parameter changes the function's argument signature, which
-- CREATE OR REPLACE cannot do in place (it would leave an ambiguous overload for
-- 4-arg named calls), so the old signature is dropped first.
DROP FUNCTION IF EXISTS public.grant_liked_song_access(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION grant_liked_song_access(
  p_account_id   UUID,
  p_origin       TEXT,
  p_requested_by TEXT DEFAULT NULL,
  p_note         TEXT DEFAULT NULL,
  p_limit        INTEGER DEFAULT 500
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit         INTEGER;
  v_applied_at    TIMESTAMPTZ;
  v_candidate_ids UUID[];
  v_candidate_cnt INTEGER;
  v_newly_unlocked UUID[];
BEGIN
  IF p_origin NOT IN ('waitlist_auto', 'operator_manual') THEN
    RAISE EXCEPTION 'grant_liked_song_access: invalid origin ''%''', p_origin;
  END IF;

  -- Clamp the requested size to a sane range. NULL falls back to the default.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 10000);

  -- 1. Create the grant row if absent. ON CONFLICT DO NOTHING preserves the
  --    original audit metadata on rerun (first writer wins).
  INSERT INTO account_liked_song_access_grant (account_id, origin, requested_by, note)
  VALUES (p_account_id, p_origin, p_requested_by, p_note)
  ON CONFLICT (account_id) DO NOTHING;

  -- 2. Lock the row so concurrent applies for this account serialize here.
  SELECT applied_at INTO v_applied_at
  FROM account_liked_song_access_grant
  WHERE account_id = p_account_id
  FOR UPDATE;

  -- 3. Already applied — nothing to do.
  IF v_applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_applied');
  END IF;

  -- 4. Snapshot the current top v_limit active liked songs (ARRAY() keeps the
  --    subquery's liked_at DESC ordering).
  SELECT ARRAY(
    SELECT ls.song_id
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
    ORDER BY ls.liked_at DESC
    LIMIT v_limit
  ) INTO v_candidate_ids;

  v_candidate_cnt := cardinality(v_candidate_ids);

  -- 5. No active liked songs yet — leave the row pending for a later sync.
  IF v_candidate_cnt = 0 THEN
    RETURN jsonb_build_object('status', 'pending_no_liked_songs');
  END IF;

  -- 6. Unlock the snapshot without charging credits. Returns only net-new /
  --    reactivated rows; songs already actively unlocked are not returned.
  SELECT ARRAY(
    SELECT u.song_id
    FROM insert_song_unlocks_without_charge(p_account_id, v_candidate_ids, 'grant') AS u(song_id)
  ) INTO v_newly_unlocked;

  -- 7. Mark applied. The benefit is the one-time snapshot decision, so this
  --    fires even when v_newly_unlocked is empty (all already unlocked).
  UPDATE account_liked_song_access_grant
  SET applied_at = now()
  WHERE account_id = p_account_id;

  RETURN jsonb_build_object(
    'status', 'applied',
    'candidate_count', v_candidate_cnt,
    'newly_unlocked_song_ids', to_jsonb(v_newly_unlocked)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.grant_liked_song_access(UUID, TEXT, TEXT, TEXT, INTEGER)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.grant_liked_song_access(UUID, TEXT, TEXT, TEXT, INTEGER)
TO service_role;
