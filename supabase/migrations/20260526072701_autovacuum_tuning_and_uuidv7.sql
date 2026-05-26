-- Schema optimizations for scale (preprod is the cheap moment to do these).
--
-- Note: the P2-2 audit item (dropping the GIN trgm indexes on `song`) was
-- REJECTED after EXPLAIN verification. The liked-songs search scans the global
-- `song` catalog via those indexes first, then joins to liked_song — so they
-- become essential as the catalog grows. They are intentionally kept.

-- ---------------------------------------------------------------------------
-- P2-5: tune autovacuum for high-churn, small tables.
--
-- The default scale_factor (0.2) triggers vacuum far too late for tables that
-- are small but churn constantly (sessions, rate limits, webhook/bridge event
-- state machines). Left untuned they accumulate dead tuples and bloat hot
-- indexes. Lower the threshold so vacuum keeps pace with churn.
-- ---------------------------------------------------------------------------
alter table session                        set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50, autovacuum_analyze_scale_factor = 0.05);
alter table rate_limit                     set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50);
alter table billing_webhook_event          set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50);
alter table billing_bridge_event           set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50);
alter table subscription_credit_conversion set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50);
alter table song_analysis                  set (autovacuum_vacuum_scale_factor = 0.10);

-- ---------------------------------------------------------------------------
-- P2-6: time-ordered UUIDs for the highest-insert tables.
--
-- Random UUIDv4 PKs scatter B-tree inserts, causing page splits and index
-- bloat as tables grow. UUIDv7 is time-ordered, so new rows append to the
-- right edge of the index — far better insert locality and cache behavior,
-- while staying a 128-bit UUID (no external API change).
--
-- PG 17 has no built-in uuidv7(); this is the standard pure-SQL implementation
-- (overlay a 48-bit ms timestamp over a v4 UUID, then flip the version nibble
-- to 7). PG 18 ships a native uuidv7() — replace this function on upgrade.
--
-- Changing the DEFAULT only affects NEW rows; existing v4 keys are untouched
-- and coexist fine (both are valid uuids).
-- ---------------------------------------------------------------------------
create or replace function public.uuidv7()
	returns uuid
	language sql
	volatile
	parallel safe
	set search_path = pg_catalog
as $$
	select encode(
		set_bit(
			set_bit(
				overlay(
					uuid_send(gen_random_uuid())
					placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
					from 1 for 6
				),
				52, 1
			),
			53, 1
		),
		'hex'
	)::uuid;
$$;

comment on function public.uuidv7() is
	'Time-ordered UUIDv7 generator (pure SQL, PG 17). Replace with native uuidv7() after upgrading to PG 18.';

-- This helper is internal; do not expose it on the public RPC surface.
revoke execute on function public.uuidv7() from anon, authenticated, public;
grant execute on function public.uuidv7() to service_role, postgres;

-- Apply to the highest-insert tables only. Low-traffic tables gain nothing and
-- there is no reason to change their generation strategy.
alter table match_result           alter column id set default public.uuidv7();
alter table song_embedding          alter column id set default public.uuidv7();
alter table job                     alter column id set default public.uuidv7();
alter table job_item_failure        alter column id set default public.uuidv7();
alter table credit_transaction      alter column id set default public.uuidv7();
alter table account_item_newness    alter column id set default public.uuidv7();
alter table job_execution_measurement alter column id set default public.uuidv7();
