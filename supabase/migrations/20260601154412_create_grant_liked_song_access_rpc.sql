-- grant_liked_song_access: atomically grant the liked-song access benefit to an
-- account. One benefit-scoped row per account; the first writer owns the audit
-- metadata. Snapshot semantics: unlocks the account's current top 500 active
-- liked songs (liked_at DESC) at apply time. Marks the row applied as long as
-- the snapshot resolves — even if some/all candidates were already unlocked.
--
-- Returns a discriminated jsonb payload keyed on "status":
--   { "status": "applied", "candidate_count": N, "newly_unlocked_song_ids": [...] }
--   { "status": "already_applied" }
--   { "status": "pending_no_liked_songs" }
CREATE OR REPLACE FUNCTION grant_liked_song_access(
  p_account_id   UUID,
  p_origin       TEXT,
  p_requested_by TEXT DEFAULT NULL,
  p_note         TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_applied_at    TIMESTAMPTZ;
  v_candidate_ids UUID[];
  v_candidate_cnt INTEGER;
  v_newly_unlocked UUID[];
BEGIN
  IF p_origin NOT IN ('waitlist_auto', 'operator_manual') THEN
    RAISE EXCEPTION 'grant_liked_song_access: invalid origin ''%''', p_origin;
  END IF;

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

  -- 4. Snapshot the current top 500 active liked songs (ARRAY() keeps the
  --    subquery's liked_at DESC ordering).
  SELECT ARRAY(
    SELECT ls.song_id
    FROM liked_song ls
    WHERE ls.account_id = p_account_id
      AND ls.unliked_at IS NULL
    ORDER BY ls.liked_at DESC
    LIMIT 500
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
  public.grant_liked_song_access(UUID, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.grant_liked_song_access(UUID, TEXT, TEXT, TEXT)
TO service_role;
