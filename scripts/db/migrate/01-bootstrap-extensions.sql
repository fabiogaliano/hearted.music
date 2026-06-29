-- Prepare the target before restoring the prod `public` dump.
--
-- The prod tables declare columns of type `extensions.vector` (pgvector, moved
-- out of `public` per Supabase's security guidance) and use `extensions.pg_trgm`
-- for trigram indexes. Those types must exist BEFORE pg_restore recreates the
-- tables, so we create the schema + extensions here first.

create schema if not exists extensions;
create extension if not exists vector  schema extensions;
create extension if not exists pg_trgm schema extensions;

-- Future migrations resolve unqualified `vector`/`gin_trgm_ops` via search_path.
alter database postgres set search_path to "$user", public, extensions;
