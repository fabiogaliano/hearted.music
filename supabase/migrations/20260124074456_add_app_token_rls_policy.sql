-- Explicit RLS policy for app_token table
-- service_role bypasses RLS anyway, but this documents intent
CREATE POLICY "service_role_only"
  ON app_token
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
