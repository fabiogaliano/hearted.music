-- Song lyric-language detection (Phase 1 / lightweight enrichment).
--
-- The worker detects a song's language from its stored lyrics with `eld` (a
-- pure-JS n-gram detector — no model file, no network). A benchmark over 45 real
-- songs put eld ahead of tinyld and fastText on both accuracy and speed for
-- whole-lyric text, which is why it's the chosen tool (see scripts/language-lab).
--
-- State machine mirrors release_year:
--   language is null  and checked_at is null      -> pending (or no lyrics yet)
--   language is null  and checked_at is not null   -> checked, undetectable/unreliable
--   language is not null                            -> detected
--
-- language_secondary captures the genuinely-bilingual / code-switched case the
-- benchmark surfaced (English verses with parenthetical French; Catalan + English),
-- where a single label is arbitrary. It's set only when the runner-up language is
-- nearly as strong as the top one.

alter table song add column if not exists language text
	check (language is null or language ~ '^[a-z]{2,3}$');
alter table song add column if not exists language_confidence real
	check (language_confidence is null or (language_confidence >= 0 and language_confidence <= 1));
alter table song add column if not exists language_secondary text
	check (language_secondary is null or language_secondary ~ '^[a-z]{2,3}$');
alter table song add column if not exists language_checked_at timestamptz;

comment on column song.language is
	'Primary lyric language (ISO 639-1, occasionally 639-3) detected from stored lyrics by eld. Null with a non-null language_checked_at = checked but undetectable/unreliable.';
comment on column song.language_confidence is
	'Detector top-1 confidence in [0,1] for song.language.';
comment on column song.language_secondary is
	'Second language for bilingual / code-switched lyrics, set only when its score rivals the primary. Null otherwise.';
comment on column song.language_checked_at is
	'When lyric-language detection was last attempted. Set whether or not a language resolved, so detection never repeats. Null = not attempted (or no lyrics yet).';

-- Read side: of the given songs, return flattened lyric text for those that have
-- real lyrics and haven't been language-checked yet. song_lyrics is keyed by
-- (song_id, source), so future providers can coexist; pick the latest lyric-
-- bearing row per song, flatten it in SQL, and drop malformed/empty documents
-- here so the worker never loops forever on a null-text candidate.
create or replace function select_songs_needing_language_detection(p_song_ids uuid[])
returns table (song_id uuid, lyrics_text text)
language sql
stable
as $$
	with lyric_candidates as (
		select sl.song_id,
			sl.updated_at,
			sl.created_at,
			sl.id,
			(
				select string_agg(line ->> 'text', E'\n')
				from jsonb_array_elements(coalesce(sl.document -> 'sections', '[]'::jsonb)) as sec
				cross join jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) as line
				where line ->> 'text' is not null
			) as lyrics_text
		from song_lyrics sl
		join song s on s.id = sl.song_id
		where sl.song_id = any (p_song_ids)
			and sl.fetch_status = 'lyrics'
			and sl.document is not null
			and s.language_checked_at is null
	)
	select distinct on (c.song_id)
		c.song_id,
		c.lyrics_text
	from lyric_candidates c
	where c.lyrics_text is not null
	order by c.song_id, c.updated_at desc, c.created_at desc, c.id desc;
$$;

comment on function select_songs_needing_language_detection(uuid[]) is
	'Flattened lyric text for the latest lyric-bearing row of each song in the set that has no language_checked_at yet (Phase-1 language detection read side).';

-- Write side: bulk-apply detection results. Set-based via jsonb_to_recordset
-- because each row carries its own language/confidence/secondary. language and
-- language_secondary are overwritten (the detector is the source of truth, unlike
-- the manually-correctable release_year), and every matched row is stamped
-- language_checked_at = now() regardless of outcome so an undetectable song is
-- never retried.
create or replace function apply_song_language(p_rows jsonb)
returns integer
language plpgsql
as $$
declare
	n integer;
begin
	update song s set
		language = v.language,
		language_confidence = v.language_confidence,
		language_secondary = v.language_secondary,
		language_checked_at = now()
	from jsonb_to_recordset(p_rows) as v(
		song_id uuid,
		language text,
		language_confidence real,
		language_secondary text
	)
	where s.id = v.song_id;
	get diagnostics n = row_count;
	return n;
end;
$$;

comment on function apply_song_language(jsonb) is
	'Bulk-apply lyric-language detection results; stamps language_checked_at = now() on every matched row regardless of whether a language resolved.';

-- Lock down the new RPCs to the service-role client, matching the posture of
-- other internal enrichment RPCs.
revoke execute on function
	public.select_songs_needing_language_detection(uuid[]),
	public.apply_song_language(jsonb)
from public, anon, authenticated;

grant execute on function
	public.select_songs_needing_language_detection(uuid[]),
	public.apply_song_language(jsonb)
to service_role;
