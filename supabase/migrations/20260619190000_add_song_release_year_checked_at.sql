-- Durable provenance for the liked-song release-year lookup.
--
-- release_year alone conflated two states: "never looked up yet" and "looked up,
-- but Spotify had no usable year". That ambiguity made every device/browser
-- re-run getTrack for the same year-less songs and prevented the control panel
-- from separating pending work from genuinely-unresolved songs. This column makes
-- the database the source of truth instead of browser-local attempted state:
--   release_year is not null                              -> resolved
--   release_year is null     and checked_at is null       -> pending lookup
--   release_year is null     and checked_at is not null   -> checked, no year
alter table song add column if not exists release_year_checked_at timestamptz;

comment on column song.release_year_checked_at is
	'When a Spotify getTrack release-year lookup was last attempted for this song. Set whether or not a year resolved, so lookups never repeat across devices/reinstalls. Null = no lookup attempted yet.';

-- Write side of the extension's getTrack lookup. Set-based via jsonb_to_recordset
-- because each row carries its own resolved year. coalesce() keeps release_year
-- idempotent: a null year (Spotify had none) never clobbers an already-resolved
-- year, and a non-null payload year never overwrites an existing one — so
-- playlist-captured years and manual control-panel corrections both win. Every
-- row touched is stamped release_year_checked_at = now() regardless of outcome.
-- Rows whose spotify_id isn't in the catalog yet (a brand-new like not yet
-- synced) simply don't match; they carry their year in the sync payload and are
-- stamped on a later sync once the row exists.
create or replace function apply_release_year_lookups(p_rows jsonb)
returns integer
language plpgsql
as $$
declare
	n integer;
begin
	update song s set
		release_year = coalesce(s.release_year, v.release_year),
		release_year_checked_at = now()
	from jsonb_to_recordset(p_rows) as v(
		spotify_id text,
		release_year smallint
	)
	where s.spotify_id = v.spotify_id;
	get diagnostics n = row_count;
	return n;
end;
$$;

comment on function apply_release_year_lookups(jsonb) is
	'Bulk-apply extension getTrack release-year lookups. Idempotent via coalesce (never clobbers an existing/manual year); stamps release_year_checked_at = now() on every matched row regardless of whether a year resolved.';
