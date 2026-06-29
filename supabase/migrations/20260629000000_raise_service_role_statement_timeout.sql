-- Raise the statement_timeout for service_role API requests.
--
-- Background jobs (enrichment work-plan selection, match-snapshot publish,
-- entitled-song probes) run through PostgREST as service_role via the admin
-- Supabase client. service_role had no explicit statement_timeout, so those
-- requests inherited the authenticator base of 8s — a web-request budget, not a
-- batch budget. During the self-host migration these multi-CTE analytical
-- queries ran cold and exceeded 8s, cancelling ~450 enrichment and
-- match_snapshot_refresh jobs with "canceling statement due to statement
-- timeout".
--
-- PostgREST applies the *request role's* statement_timeout (this is why anon=3s
-- and authenticated=8s differ on the same authenticator login), so setting it on
-- service_role raises the ceiling only for trusted server-side traffic — never
-- for client-exposed anon/authenticated requests. A function-local SET would not
-- help: the timeout timer is armed when the top-level statement starts, before
-- the function body runs.
alter role service_role set statement_timeout = '120s';

-- PostgREST caches role settings; tell it to reload so the change takes effect
-- without a restart.
notify pgrst, 'reload config';
