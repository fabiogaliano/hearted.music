-- account_activity (20260617123823) enabled RLS but shipped without a policy.
-- RLS with no policy denies nothing meaningful through PostgREST only by accident
-- of having no permissive policy; the security invariant (and the rest of the
-- schema) requires an explicit deny-all so the anon/authenticated endpoint is
-- provably closed. The app reaches this table solely via service_role, which
-- bypasses RLS, so deny-all costs the application nothing.

CREATE POLICY "account_activity_deny_all" ON account_activity FOR ALL USING (false);
