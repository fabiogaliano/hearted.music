-- Song-level vocal gender, derived from the gender of every CREDITED artist
-- (song.artist_ids, which includes featured artists — so "male producer feat.
-- female vocalist" resolves to a female signal without any audio analysis).
--
--   female  = a credited artist is female, none male   (solo female / female feat.)
--   male    = a credited artist is male, none female
--   mixed   = both present (duet, OR producer + opposite-gender feature)
--   unknown = no gendered credited artist (groups / unlinked-in-MusicBrainz)
--
-- For "female vocals" matching, female + mixed both mean "includes female vocals".
-- The unknown bucket is the metadata gap (bands, long tail) where a future
-- Wikidata band-membership rule or an LLM guess would refine the value.

alter table song add column if not exists vocal_gender text
	check (vocal_gender in ('female', 'male', 'mixed', 'unknown'));

comment on column song.vocal_gender is
	'Derived vocal-gender from credited artists'' MusicBrainz gender. female/mixed both include female vocals; unknown = groups/unlinked (future Wikidata/LLM refinement).';

-- Pure derivation from a credit list. STABLE (reads artist), not IMMUTABLE.
create or replace function compute_song_vocal_gender(p_artist_ids text[])
returns text
language sql
stable
as $$
	select case
		when has_female and has_male then 'mixed'
		when has_female then 'female'
		when has_male then 'male'
		else 'unknown'
	end
	from (
		select
			coalesce(bool_or(a.gender = 'female'), false) as has_female,
			coalesce(bool_or(a.gender = 'male'), false) as has_male
		from unnest(p_artist_ids) as aid
		left join artist a on a.spotify_id = aid
	) agg;
$$;

-- Keep new/edited songs fresh as they sync. Fires only when artist_ids change,
-- so the set-based refresh below (which only touches vocal_gender) never recurses.
create or replace function set_song_vocal_gender()
returns trigger
language plpgsql
as $$
begin
	new.vocal_gender := compute_song_vocal_gender(new.artist_ids);
	return new;
end;
$$;

drop trigger if exists song_set_vocal_gender on song;
create trigger song_set_vocal_gender
	before insert or update of artist_ids on song
	for each row
	execute function set_song_vocal_gender();

-- Source-of-truth recompute. The trigger covers song changes but NOT artist
-- gender changes (artists link to songs only through an array, no FK), so this
-- is run after the gender backfill and any time artist gender is refreshed.
-- `is distinct from` skips unchanged rows to avoid needless writes/bloat.
create or replace function refresh_song_vocal_gender()
returns integer
language plpgsql
as $$
declare
	n integer;
begin
	with agg as (
		select s.id,
			case
				when coalesce(bool_or(a.gender = 'female'), false)
					and coalesce(bool_or(a.gender = 'male'), false) then 'mixed'
				when coalesce(bool_or(a.gender = 'female'), false) then 'female'
				when coalesce(bool_or(a.gender = 'male'), false) then 'male'
				else 'unknown'
			end as vg
		from song s
		left join artist a on a.spotify_id = any (s.artist_ids)
		group by s.id
	)
	update song s
	set vocal_gender = agg.vg
	from agg
	where agg.id = s.id
		and s.vocal_gender is distinct from agg.vg;
	get diagnostics n = row_count;
	return n;
end;
$$;
