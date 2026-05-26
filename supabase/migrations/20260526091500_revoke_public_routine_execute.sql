-- Finish collapsing the public RPC surface.
--
-- The earlier hardening migration revoked direct anon/authenticated routine
-- grants, but PostgreSQL still grants EXECUTE on newly-created functions to
-- PUBLIC by default. Because anon/authenticated inherit PUBLIC, a future
-- postgres-owned function in the public schema would otherwise become callable
-- from the internet via PostgREST unless every migration remembered to revoke
-- it manually.

-- Existing public-schema routines are internal implementation details only.
revoke execute on all routines in schema public
	from public, anon, authenticated;

grant execute on all routines in schema public to service_role;

-- Future postgres-owned functions must not inherit PUBLIC EXECUTE.
alter default privileges for role postgres
	revoke execute on functions from public;

-- Keep the service-role application path working for future public functions.
alter default privileges for role postgres in schema public
	grant execute on functions to service_role;
