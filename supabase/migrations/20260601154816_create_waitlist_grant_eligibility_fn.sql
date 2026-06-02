-- Waitlist eligibility for the liked-song access benefit, evaluated against
-- account.email (not the sync payload — the sync route doesn't persist the
-- profile email). Normalization happens at query time on BOTH sides because
-- historical waitlist rows kept their raw casing/whitespace; relying on
-- write-time normalization alone would miss them. PostgREST can't express a
-- lower(btrim(col)) join, so this lives in SQL.
--
-- Eligible when:
--   * account.email is not null
--   * a waitlist row matches on lower(btrim(email))
--   * that waitlist row predates (or equals) the account's creation
--   * no grant row exists yet for the account
CREATE OR REPLACE FUNCTION is_waitlist_eligible_for_liked_song_grant(
  p_account_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM account a
      JOIN waitlist w
        ON lower(btrim(w.email)) = lower(btrim(a.email))
      WHERE a.id = p_account_id
        AND a.email IS NOT NULL
        AND w.created_at <= a.created_at
    )
    AND NOT EXISTS (
      SELECT 1
      FROM account_liked_song_access_grant g
      WHERE g.account_id = p_account_id
    );
$$;

REVOKE EXECUTE ON FUNCTION
  public.is_waitlist_eligible_for_liked_song_grant(UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.is_waitlist_eligible_for_liked_song_grant(UUID)
TO service_role;
