-- Add 'grant' as a valid account_song_unlock source for the liked-song access
-- benefit. Net-new source value, so both the table check constraint and the
-- insert_song_unlocks_without_charge runtime guard have to learn it; the
-- original definitions live in historical migrations we must not edit in place.

-- 1. Extend the source check constraint with 'grant'.
ALTER TABLE account_song_unlock
  DROP CONSTRAINT account_song_unlock_source_check;

ALTER TABLE account_song_unlock
  ADD CONSTRAINT account_song_unlock_source_check
    CHECK (source IN (
      'free_auto', 'pack', 'unlimited', 'self_hosted', 'admin', 'grant'
    ));

-- 2. Replace insert_song_unlocks_without_charge so its guard accepts 'grant'.
--    Body is unchanged from 20260405160000_core_unlock_rpcs.sql except for the
--    added 'grant' in the allowed-source check.
CREATE OR REPLACE FUNCTION insert_song_unlocks_without_charge(
  p_account_id              UUID,
  p_song_ids                UUID[],
  p_source                  TEXT,
  p_granted_stripe_event_id TEXT DEFAULT NULL
) RETURNS TABLE(song_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  -- 'unlimited' is not valid here; use activate_unlimited_songs for that source
  IF p_source NOT IN ('free_auto', 'pack', 'self_hosted', 'admin', 'grant') THEN
    RAISE EXCEPTION 'insert_song_unlocks_without_charge: invalid source ''%''', p_source;
  END IF;

  RETURN QUERY
  INSERT INTO account_song_unlock (account_id, song_id, source, granted_stripe_event_id)
  SELECT p_account_id, s, p_source, p_granted_stripe_event_id
  FROM unnest(p_song_ids) AS s
  ON CONFLICT (account_id, song_id) DO UPDATE
    SET source                  = EXCLUDED.source,
        granted_stripe_event_id = EXCLUDED.granted_stripe_event_id,
        revoked_at              = NULL,
        revoked_reason          = NULL,
        revoked_stripe_event_id = NULL
    WHERE account_song_unlock.revoked_at IS NOT NULL
  RETURNING account_song_unlock.song_id;
END;
$$;
