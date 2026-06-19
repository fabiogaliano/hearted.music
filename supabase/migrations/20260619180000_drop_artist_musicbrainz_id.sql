-- Drop the dead artist.musicbrainz_id column.
--
-- It was added alongside artist.gender (20260619100000) for the original
-- MusicBrainz-API backfill, which resolved a Spotify id to an MBID before reading
-- gender. The runtime vocal-gender pipeline that replaced it resolves gender from
-- a local MusicBrainz-derived SQLite lookup + Wikidata fallback and never stores
-- or reads an MBID — gender, band_gender, wikidata_id and the *_checked_at
-- timestamps carry all the provenance we keep. No code path references this
-- column, so it's removed.
alter table artist drop column if exists musicbrainz_id;
