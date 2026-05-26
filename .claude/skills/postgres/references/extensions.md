# Extensions

```sql
SELECT * FROM pg_available_extensions ORDER BY name;   -- what's installable
SELECT * FROM pg_extension;                            -- what's installed
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

> No longer needed: **`uuid-ossp`** (`gen_random_uuid()` is built into core since PG 13; `uuidv7()` since PG 18). Don't add it to new schema.

## Pick by need

| Need | Extension | Note |
|---|---|---|
| Query performance visibility | **pg_stat_statements** | essential; `shared_preload_libraries` + restart |
| Fuzzy / substring text | **pg_trgm** | GIN trigram index makes `ILIKE '%x%'` and similarity fast |
| Vector / semantic search | **pgvector** | HNSW or IVFFlat indexes; embeddings/RAG |
| Geospatial | **postgis** | full spatial types, GiST indexes |
| Hashing / encryption | **pgcrypto** | `gen_random_bytes`, `pgp_sym_*`, digests |
| Exclusion constraints mixing `=` and ranges | **btree_gist** | needed for no-overlap constraints |
| Online bloat removal | **pg_repack** | rewrites tables/indexes without long locks |
| Partition automation | **pg_partman** | auto-create + retention |
| Cross-database queries | **postgres_fdw** | query/join remote Postgres |
| Time-series | **timescaledb** | hypertables, compression, continuous aggregates |

## pg_stat_statements

```ini
# postgresql.conf (restart). Values below override the defaults
# (max 5000, track 'top', compute_query_id 'auto') for fuller coverage.
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.max = 10000
pg_stat_statements.track = all
compute_query_id = on
```
```sql
-- Biggest total time sinks (PG 13+ columns)
SELECT query, calls, total_exec_time, mean_exec_time, stddev_exec_time, rows
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
SELECT pg_stat_statements_reset();
```

## pg_trgm — fuzzy & unanchored LIKE

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_users_email_trgm ON users USING GIN (email gin_trgm_ops);
SELECT * FROM users WHERE email ILIKE '%john%';                  -- now index-backed
SELECT * FROM users WHERE email % 'jon@exmaple.com' ORDER BY similarity(email,'jon@exmaple.com') DESC;
```

## pgvector — similarity search

```sql
CREATE EXTENSION IF NOT EXISTS vector;   -- current line is 0.8.x
CREATE TABLE embeddings (id bigint GENERATED ALWAYS AS IDENTITY, content text, embedding vector(1536));
-- HNSW: best recall/speed; IVFFlat: lower memory. cosine ops shown.
CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops);
SELECT content, 1 - (embedding <=> $1) AS similarity
FROM embeddings ORDER BY embedding <=> $1 LIMIT 10;   -- <=> cosine, <-> L2, <#> neg inner product, <+> L1
SET hnsw.ef_search = 100;        -- default 40; higher = better recall, slower
SET hnsw.iterative_scan = relaxed_order;  -- so WHERE-filtered queries still return enough rows
```

- Op classes: `vector_{cosine,l2,ip,l1}_ops`. For memory, store `halfvec` (2 bytes/dim, ~half the size) and index with `halfvec_*_ops`; `bit` (Hamming/Jaccard) and `sparsevec` types also exist (since 0.7.0).
- With pre-filtering (`WHERE … ORDER BY embedding <=> $1`), a plain HNSW scan can return fewer than `LIMIT` rows — enable `hnsw.iterative_scan` (0.8.0+) to keep fetching.

## pgcrypto — prefer app-side password hashing

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT gen_random_uuid();                       -- (also core since PG 13)
SELECT encode(digest('data','sha256'),'hex');
SELECT pgp_sym_encrypt('secret', :key);
```
`crypt()/gen_salt('bf')` works for password hashing but bcrypt caps at 72 bytes and hashing in the DB sends plaintext over the wire and into logs/`pg_stat_statements`. Prefer hashing in the app (argon2/bcrypt) and store only the digest.

## PostGIS — essentials

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE places (id bigint GENERATED ALWAYS AS IDENTITY, geom geometry(Point,4326));
CREATE INDEX ON places USING GIST (geom);
-- distance in meters via geography cast
SELECT id, ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS m
FROM places WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, 1000)
ORDER BY m;
```
