CREATE OR REPLACE FUNCTION public.claim_handle(
  p_account_id UUID,
  p_handle     TEXT
)
RETURNS TABLE (
  status TEXT,
  owned_handle TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_handle TEXT;
  v_existing_step TEXT;
  v_onboarding_completed_at TIMESTAMPTZ;
BEGIN
  SELECT handle
  INTO v_existing_handle
  FROM account
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_handle: account % not found', p_account_id;
  END IF;

  SELECT onboarding_step, onboarding_completed_at
  INTO v_existing_step, v_onboarding_completed_at
  FROM user_preferences
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_handle: preferences for account % not found', p_account_id;
  END IF;

  IF v_existing_handle IS NOT NULL AND v_existing_handle <> p_handle THEN
    RETURN QUERY SELECT 'already_owned'::TEXT, v_existing_handle;
    RETURN;
  END IF;

  IF v_existing_handle IS NULL
     AND v_onboarding_completed_at IS NULL
     AND v_existing_step NOT IN (
       'claim-handle',
       'flag-playlists',
       'pick-demo-song',
       'song-walkthrough',
       'match-walkthrough',
       'plan-selection',
       'complete'
     ) THEN
    RETURN QUERY SELECT 'not_ready'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_existing_handle IS NULL THEN
    UPDATE account
    SET handle = p_handle
    WHERE id = p_account_id;

    v_existing_handle := p_handle;

    IF v_onboarding_completed_at IS NULL THEN
      UPDATE user_preferences
      SET
        onboarding_step = 'flag-playlists',
        phase_job_ids = NULL
      WHERE account_id = p_account_id;
    END IF;
  ELSIF v_onboarding_completed_at IS NULL AND v_existing_step = 'claim-handle' THEN
    UPDATE user_preferences
    SET
      onboarding_step = 'flag-playlists',
      phase_job_ids = NULL
    WHERE account_id = p_account_id;
  END IF;

  RETURN QUERY SELECT 'claimed'::TEXT, v_existing_handle;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_handle(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_handle(UUID, TEXT)
TO service_role;
