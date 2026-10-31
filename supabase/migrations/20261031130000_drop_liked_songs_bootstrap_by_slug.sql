-- Contract step for 20261030120000_liked_songs_deep_link_window.sql: deep links
-- now open on get_liked_songs_window_by_slug, and nothing in the app, worker,
-- extension or other SQL functions calls the bootstrap function any more.

DROP FUNCTION IF EXISTS public.get_liked_songs_bootstrap_by_slug(uuid, text, integer, double precision); -- migration-safety: allow last caller removed in c387af0a (deployed 2026-10-30); no SQL function references it
