-- Move vector extension out of public schema per Supabase security recommendation.
-- Existing columns and indexes are unaffected (stored by OID, not schema-qualified name).

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- Include extensions in default search_path so future migrations resolve vector types
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;
