-- RPCs for in-pipeline vocal-gender resolution (Phase 1 / lightweight enrichment).
--
-- The worker resolves a new artist's gender from a local MusicBrainz dump first,
-- then Wikidata as fallback — never the MusicBrainz API. These two functions are
-- the write side of that flow: bulk-apply the resolved genders, then recompute
-- vocal_gender for just the affected songs.

-- Bulk-apply a batch of resolved artists. Set-based via jsonb_to_recordset
-- because each row carries its own gender/band_gender/wikidata_id (a grouped
-- UPDATE ... IN can't express per-row values). coalesce() keeps it idempotent:
-- a null in the payload never clobbers an already-resolved column. Every applied
-- artist is stamped musicbrainz_checked_at = now() (the local dump was always
-- the first hop attempted); wikidata_checked_at is stamped only when Wikidata
-- was actually queried for that artist.
create or replace function apply_artist_gender_resolution(p_rows jsonb)
returns integer
language plpgsql
as $$
declare
	n integer;
begin
	update artist a set
		gender = coalesce(v.gender, a.gender),
		band_gender = coalesce(v.band_gender, a.band_gender),
		wikidata_id = coalesce(v.wikidata_id, a.wikidata_id),
		musicbrainz_checked_at = now(),
		wikidata_checked_at = case when v.wd_checked then now() else a.wikidata_checked_at end
	from jsonb_to_recordset(p_rows) as v(
		spotify_id text,
		gender text,
		band_gender text,
		wikidata_id text,
		wd_checked boolean
	)
	where a.spotify_id = v.spotify_id;
	get diagnostics n = row_count;
	return n;
end;
$$;

comment on function apply_artist_gender_resolution(jsonb) is
	'Bulk-apply locally/Wikidata-resolved artist genders (Phase-1 vocal-gender). Idempotent via coalesce; stamps musicbrainz_checked_at always, wikidata_checked_at when wd_checked.';

-- Recompute song.vocal_gender for a specific set of songs (the enrichment
-- batch). Same coalescing rule as refresh_song_vocal_gender() but scoped, so
-- Phase 1 doesn't full-scan the catalog on every chunk. `is distinct from`
-- skips unchanged rows.
create or replace function refresh_song_vocal_gender_for(p_song_ids uuid[])
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
		where s.id = any (p_song_ids)
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

comment on function refresh_song_vocal_gender_for(uuid[]) is
	'Scoped recompute of song.vocal_gender for the given song ids (Phase-1 enrichment batch); same rule as refresh_song_vocal_gender() without the full-catalog scan.';
