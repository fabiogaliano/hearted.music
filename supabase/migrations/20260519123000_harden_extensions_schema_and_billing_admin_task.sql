-- Preprod posture: browser roles do not need direct access to the extensions
-- schema, and billing admin tasks remain backend-private.

REVOKE USAGE ON SCHEMA extensions FROM anon, authenticated;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role;

CREATE POLICY "billing_admin_task_deny_all"
  ON public.billing_admin_task
  FOR ALL
  USING (false);
