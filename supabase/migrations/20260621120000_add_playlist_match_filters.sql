-- Persist hard match filters on each playlist (crisp-metadata-hard-filters, Wave 1).
--
-- match_filters stores a PlaylistMatchFiltersV1 object. The root default is
-- { "version": 1 } which means "no active filters". Inactive filter fields are
-- omitted; the object is never null. Strict schema validation (unknown-key rejection,
-- type checking, normalization rules) lives in app code — see
-- src/lib/domains/taste/match-filters/. Only a light object check is encoded here so the
-- DB does not need to be migrated every time the app-level schema evolves.

alter table playlist add column match_filters jsonb not null default '{"version":1}'::jsonb;

alter table playlist add constraint playlist_match_filters_object
	check (jsonb_typeof(match_filters) = 'object');

-- Update the vocal_gender comment to reflect exact-only filter semantics introduced
-- by match filters: female passes only song.vocal_gender = 'female', male passes
-- only song.vocal_gender = 'male', and mixed does not pass either gender filter.
comment on column song.vocal_gender is
	'Derived vocal-gender from credited artists'' MusicBrainz gender. For hard-filter matching: female passes only female, male passes only male; mixed, unknown, and null fail both gender filters.';
