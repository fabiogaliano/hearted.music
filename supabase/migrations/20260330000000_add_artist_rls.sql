-- Enable RLS on artist table and deny direct access
-- Consistent with all other tables: service_role bypasses RLS, anon/authenticated are blocked

ALTER TABLE artist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "artist_deny_all" ON artist FOR ALL USING (false);
