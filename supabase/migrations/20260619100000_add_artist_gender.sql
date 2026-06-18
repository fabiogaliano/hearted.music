-- Artist gender + MusicBrainz provenance.
-- gender is the *artist's* identity gender from MusicBrainz (Person entities only),
-- used as a cheap, high-precision PRIOR for vocal-gender matching ("female vocals").
-- It is NOT vocal gender: groups return null (MusicBrainz has no group gender), and a
-- solo producer's gender can differ from a track's guest vocalist. Song-level vocal
-- classification (audio ML) is meant to fill those gaps and override on disagreement.
--
-- Resolution path (Spotify id -> MusicBrainz, both calls rate-limited to 1 req/s/IP):
--   GET /ws/2/url?resource=open.spotify.com/artist/<id>&inc=artist-rels  -> MBID
--   GET /ws/2/artist/<mbid>                                              -> type, gender
-- Coverage probe (n=180): 82% have an MB link, 59% resolve to a gendered Person.

alter table artist add column if not exists gender text
	check (gender in ('male', 'female', 'other'));

alter table artist add column if not exists musicbrainz_id text;

alter table artist add column if not exists musicbrainz_checked_at timestamptz;

comment on column artist.gender is
	'Artist identity gender from MusicBrainz (Person only); null for groups/unlinked/unknown. A prior for vocal-gender matching, not vocal gender itself.';
comment on column artist.musicbrainz_id is
	'Resolved MusicBrainz artist MBID (join key for future enrichment); null if no Spotify link exists in MusicBrainz.';
comment on column artist.musicbrainz_checked_at is
	'When MusicBrainz resolution was last attempted. Set regardless of outcome so the backfill is idempotent/resumable (skip rows where not null).';
