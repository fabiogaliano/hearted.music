-- Album release year, sourced from intercepted Spotify pathfinder data:
--   getTrack            → albumOfTrack.date.year            (clean int, backfill path)
--   fetchPlaylistContents → firstPublishedAt.isoString[:4]  (opportunistic, playlist tracks)
-- fetchLibraryTracks (liked songs) does NOT carry a release date, so liked-only
-- songs stay null until a getTrack backfill fills them.
alter table song add column release_year smallint;

comment on column song.release_year is
	'Album release year from Spotify pathfinder. Null until captured (liked-only songs need a getTrack backfill).';

-- A single sync imports the same song through both the liked path (no year) and
-- the playlist path (year present), in arbitrary order. The catalog upsert writes
-- every column it is given, so a later null-bearing liked-import would otherwise
-- erase a year a playlist-import just captured. Preserve a known year whenever an
-- update arrives without one, making the write order-independent.
create or replace function preserve_song_release_year()
returns trigger
language plpgsql
as $$
begin
	if new.release_year is null then
		new.release_year := old.release_year;
	end if;
	return new;
end;
$$;

create trigger song_preserve_release_year
	before update on song
	for each row
	execute function preserve_song_release_year();
