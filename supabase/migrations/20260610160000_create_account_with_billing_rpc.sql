-- Provision account + account_billing atomically.
--
-- createAccountForBetterAuthUser previously issued two sequential app-side inserts
-- (account, then account_billing). A failure between them left an account with no
-- billing row. Reads self-heal to FREE_BILLING_STATE, but a self-hosted
-- deployment's unlimited_access_source='self_hosted' would be silently lost,
-- downgrading the account to free tier. Folding both inserts into one function
-- makes them a single transaction.
--
-- The self_hosted decision is app-side (env.BILLING_ENABLED), so it is passed in
-- as p_unlimited_access_source rather than derived in SQL — a plain AFTER INSERT
-- trigger cannot see the deployment's billing mode.

CREATE OR REPLACE FUNCTION create_account_with_billing(
  p_better_auth_user_id TEXT,
  p_email TEXT,
  p_display_name TEXT,
  p_unlimited_access_source TEXT DEFAULT NULL
)
RETURNS account
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account account;
BEGIN
  INSERT INTO account (better_auth_user_id, email, display_name)
  VALUES (p_better_auth_user_id, p_email, p_display_name)
  RETURNING * INTO v_account;

  -- ON CONFLICT keeps this idempotent on an account_id collision, mirroring the
  -- app's prior tolerance of the unique-violation 23505 on the billing insert.
  INSERT INTO account_billing (account_id, unlimited_access_source)
  VALUES (v_account.id, p_unlimited_access_source)
  ON CONFLICT (account_id) DO NOTHING;

  RETURN v_account;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.create_account_with_billing(TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.create_account_with_billing(TEXT, TEXT, TEXT, TEXT)
TO service_role;
