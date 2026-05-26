-- Security hardening for preprod launch.
--
-- Context: the application accesses Postgres exclusively through the Supabase
-- service-role key. Sessions are handled by Better Auth (not Supabase Auth), so
-- the `authenticated` role is never assumed by a real request, and the anon key
-- is never used to build a client. RLS (deny-all on every table) is the only
-- thing standing between the public PostgREST endpoint and the data.

-- ---------------------------------------------------------------------------
-- P0-1: harden mark_stale_extension_sync_jobs
--
-- This SECURITY DEFINER function shipped (migration 20260525175127) without a
-- pinned search_path and stayed EXECUTE-able by anon/authenticated, unlike the
-- other 43 internal RPCs. Because it takes an account_id and fails that
-- account's in-flight sync jobs, an unauthenticated caller could fail another
-- tenant's syncs via POST /rest/v1/rpc/mark_stale_extension_sync_jobs.
-- ---------------------------------------------------------------------------
alter function public.mark_stale_extension_sync_jobs(uuid, interval)
	set search_path = public, pg_temp;

revoke execute on function public.mark_stale_extension_sync_jobs(uuid, interval)
	from anon, authenticated, public;
grant execute on function public.mark_stale_extension_sync_jobs(uuid, interval)
	to service_role;

-- ---------------------------------------------------------------------------
-- P1-1: collapse the public-endpoint privilege surface.
--
-- Supabase's bootstrap grants ALL on every public object to anon/authenticated
-- and relies entirely on RLS to neutralize it. Since this app never uses those
-- roles, the grants are pure attack surface: one future table created without a
-- deny-all policy would be immediately world-readable/writable. Revoke the
-- standing grants and stop new postgres-owned objects from inheriting them.
-- (The CI guard test enforces the RLS half of this invariant.)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines in schema public from anon, authenticated;

-- Future objects created by the migration role (postgres) must not be granted
-- to anon/authenticated either.
alter default privileges in schema public
	revoke all on tables from anon, authenticated;
alter default privileges in schema public
	revoke all on sequences from anon, authenticated;
alter default privileges in schema public
	revoke all on routines from anon, authenticated;
