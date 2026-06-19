-- Band vocal gender from Wikidata membership — all cases (female/male/mixed).
-- A band has no gender of its own, but Wikidata links its members (P527 "has
-- part" / P463 "member of"), each a person with a gender (P21):
--   female = every gendered member female   (e.g. The Weather Girls)
--   male   = every gendered member male      (e.g. KISS)
--   mixed  = both genders present            (e.g. Earth, Wind & Fire)
-- This is the only metadata path to bands now that audio classification is out
-- of scope.
--
-- Caveat: trust band_gender LESS than a solo artist's gender. Wikidata member
-- lists are often incomplete and skew to instrumentalists, so a band's actual
-- vocalist can be missing — verified with Margaret Island (female-fronted, but
-- Wikidata listed only its male drummer, so it reads "male"). Labels backed by a
-- single member are the weak ones; a member-count confidence signal can be added
-- later if this proves noisy in matching.

alter table artist add column if not exists band_gender text;
alter table artist drop constraint if exists artist_band_gender_check;
alter table artist add constraint artist_band_gender_check
	check (band_gender in ('female', 'male', 'mixed'));
alter table artist add column if not exists wikidata_id text;
alter table artist add column if not exists wikidata_checked_at timestamptz;

comment on column artist.band_gender is
	'Vocal gender inferred from Wikidata band membership: female/male (all members one gender) or mixed (both). Null for solo artists / unresolved. Weaker than artist.gender — member lists are often incomplete (see migration note).';
comment on column artist.wikidata_id is
	'Resolved Wikidata QID (provenance/join key); null if no Spotify link exists in Wikidata.';
comment on column artist.wikidata_checked_at is
	'When Wikidata band resolution was last attempted. Set regardless of outcome so the backfill is idempotent/resumable (skip rows where not null).';

-- Fold band_gender into the song derivation. A credited artist contributes a
-- female signal if they are a female person OR a female/mixed band, and likewise
-- for male; a mixed band contributes both. compute + refresh stay in lockstep.
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
			coalesce(bool_or(a.gender = 'female' or a.band_gender in ('female', 'mixed')), false) as has_female,
			coalesce(bool_or(a.gender = 'male' or a.band_gender in ('male', 'mixed')), false) as has_male
		from unnest(p_artist_ids) as aid
		left join artist a on a.spotify_id = aid
	) agg;
$$;

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
				when coalesce(bool_or(a.gender = 'female' or a.band_gender in ('female', 'mixed')), false)
					and coalesce(bool_or(a.gender = 'male' or a.band_gender in ('male', 'mixed')), false) then 'mixed'
				when coalesce(bool_or(a.gender = 'female' or a.band_gender in ('female', 'mixed')), false) then 'female'
				when coalesce(bool_or(a.gender = 'male' or a.band_gender in ('male', 'mixed')), false) then 'male'
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
