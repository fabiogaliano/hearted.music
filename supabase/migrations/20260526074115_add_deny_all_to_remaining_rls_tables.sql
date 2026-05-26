-- Completes the deny-all policy convention started in 20260526060933.
--
-- These 7 tables had RLS enabled but no explicit policy, relying on Postgres's
-- implicit deny-all. App/auth access goes through the postgres/service_role
-- roles (BYPASSRLS), so this only affects anon/authenticated — already denied.
-- Better Auth owns user/session/oauth_account/verification/rate_limit and
-- connects as the table-owning postgres role, which bypasses RLS regardless of
-- these policies. Making the deny explicit means every public table now reads
-- the same way to an auditor and satisfies the "RLS + policy" CI guard.

CREATE POLICY "user_deny_all" ON "user" FOR ALL USING (false);
CREATE POLICY "session_deny_all" ON session FOR ALL USING (false);
CREATE POLICY "oauth_account_deny_all" ON oauth_account FOR ALL USING (false);
CREATE POLICY "verification_deny_all" ON verification FOR ALL USING (false);
CREATE POLICY "rate_limit_deny_all" ON rate_limit FOR ALL USING (false);
CREATE POLICY "extension_api_token_deny_all" ON extension_api_token FOR ALL USING (false);
CREATE POLICY "job_execution_measurement_deny_all" ON job_execution_measurement FOR ALL USING (false);
