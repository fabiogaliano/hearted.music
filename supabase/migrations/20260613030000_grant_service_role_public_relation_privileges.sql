-- Grant the server-only service_role the relation privileges required by the
-- app/worker admin Supabase client.
--
-- Security posture remains unchanged for browser-facing roles:
--   - anon/authenticated keep their public-schema table/sequence grants revoked
--   - table RLS and deny-all policies remain enabled
--   - service_role already has BYPASSRLS, but still needs normal PostgreSQL
--     relation privileges for PostgREST table/view access
--
-- Without these explicit grants, direct server-side reads such as the worker's
-- library-processing terminal recovery fail with 42501 permission denied even
-- when using SUPABASE_SERVICE_ROLE_KEY.

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA public
TO service_role;

GRANT USAGE, SELECT, UPDATE
ON ALL SEQUENCES IN SCHEMA public
TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT USAGE, SELECT, UPDATE
ON SEQUENCES TO service_role;
