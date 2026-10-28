-- Genre reference data for ranking the studio preview in Postgres.
--
-- The TypeScript matcher scores genres from
-- src/lib/domains/taste/genre-similarity/table.json (directed similarity per
-- canonical genre pair) after canonicalizing spellings through CANON_MAP in
-- src/lib/integrations/lastfm/whitelist.ts. The SQL ranking needs the same two
-- facts, so they are copied here. Rows are owned by the generated seed
-- migration (scripts/db/genre-seed.ts) and never written by the app; the seed
-- records GENRE_TABLE_VERSION and a content hash in the table comment.
--
-- Additive only. Backend-private like every other table: RLS deny-all, no
-- anon/authenticated grants; the SECURITY DEFINER ranking function reads them.

CREATE TABLE public.genre_similarity (
  from_genre TEXT NOT NULL,
  to_genre TEXT NOT NULL,
  similarity DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (from_genre, to_genre)
);

-- The ranking looks edges up from the song-genre side too (the loader's
-- reverse-direction fallback), which the primary key cannot serve.
CREATE INDEX idx_genre_similarity_to_from ON public.genre_similarity (to_genre, from_genre);

CREATE TABLE public.genre_alias (
  alias TEXT PRIMARY KEY,
  canonical TEXT NOT NULL
);

ALTER TABLE public.genre_similarity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genre_alias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "genre_similarity_deny_all" ON public.genre_similarity FOR ALL USING (false);
CREATE POLICY "genre_alias_deny_all" ON public.genre_alias FOR ALL USING (false);

REVOKE ALL ON public.genre_similarity FROM anon, authenticated;
REVOKE ALL ON public.genre_alias FROM anon, authenticated;
