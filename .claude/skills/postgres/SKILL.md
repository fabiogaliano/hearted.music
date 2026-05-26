---
name: postgres
description: Definitive PostgreSQL engineering guide for PG 14–18. Use for schema and data-type design, index selection, EXPLAIN and query tuning, JSONB, VACUUM/autovacuum, connection pooling, table partitioning, safe production migrations (lock-free DDL), Row-Level Security, replication, and backups. Enforces modern conventions (IDENTITY over serial, gen_random_uuid/uuidv7 over uuid-ossp, timestamptz, total_exec_time columns) and flags legacy patterns. Triggers on Postgres/PostgreSQL, EXPLAIN ANALYZE, pg_stat_statements, index design, JSONB, slow query, schema review, migration safety, autovacuum, bloat, pgbouncer/supavisor, RLS.
---

# PostgreSQL

Senior PostgreSQL engineering. Correctness first, then performance. Every recommendation here is verified against PG 14–18 docs and current practitioner consensus (2025–2026). When a feature is version-gated, the version is named.

## Version landscape (May 2026)

- **Latest stable: PG 18** (released 2025-09-25). Supported majors: **14, 15, 16, 17, 18**. **PG 13 and older are EOL** (PG 13 went EOL 2025-11-13) — do not target them. **PG 14 reaches EOL ~Nov 2026**, so treat it as the floor and plan upgrades off it.
- Assume PG 16+ unless told otherwise. If unsure of the server version, run `SHOW server_version;` before giving version-specific advice.

## Modern defaults — use these, not the legacy form

These are the corrections that separate current Postgres from stale guides. Apply them by default and call out the legacy form when you see it.

| Concern | ✅ Modern | ❌ Legacy / wrong |
|---|---|---|
| Auto-increment PK | `id bigint GENERATED ALWAYS AS IDENTITY` | `serial` / `bigserial` |
| Random UUID | `gen_random_uuid()` (built-in, PG 13+) | `uuid-ossp` + `uuid_generate_v4()` |
| UUID PK at scale | `uuidv7()` (PG 18) — time-ordered, index-friendly | `uuid_generate_v4()` random → B-tree bloat |
| Timestamps | `timestamptz` (stores UTC) | `timestamp` (no zone, ambiguous) |
| Money | `numeric(12,2)` or integer cents | `money` type, `float`/`double` |
| Strings | `text` (+ `CHECK (char_length(...) <= n)` if a cap is truly needed) | `char(n)`, arbitrary `varchar(n)` |
| Upsert | `INSERT ... ON CONFLICT` (simple) / `MERGE` (PG 15+, multi-branch) | client-side read-then-write |
| Slow-query view | `total_exec_time`, `mean_exec_time` (PG 13+) | `total_time`, `mean_time` (errors on PG 13+) |
| EXPLAIN | `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)` | plain `EXPLAIN` for tuning (no real costs) |
| Add index in prod | `CREATE INDEX CONCURRENTLY` | `CREATE INDEX` (holds a write lock) |

> On PG 18, `BUFFERS` is on by default with `ANALYZE`. `SETTINGS` needs PG 12+, `WAL` needs PG 13+.

## Core workflow: diagnose → change → verify

Never guess. Measure, change one thing, re-measure.

```sql
-- 1. Find the cost. Requires pg_stat_statements (see references/operations.md).
SELECT query, calls, mean_exec_time, total_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC          -- total time = where the server actually spends its life
LIMIT 20;

-- 2. Understand the plan. ANALYZE runs it; BUFFERS shows cache vs disk.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT ...;
-- Look for: Seq Scan on a large table, rows estimate vs actual off by >10x,
-- Nested Loop over many rows, Sort/Hash spilling to disk ("external merge Disk"),
-- high "shared read" (cache misses) vs "shared hit".

-- 3. Make ONE targeted change (index / rewrite / stats), in production use CONCURRENTLY.
CREATE INDEX CONCURRENTLY idx_orders_customer_status
  ON orders (customer_id, status) WHERE status = 'pending';

-- 4. Re-run EXPLAIN ANALYZE. Confirm the planner uses the change and actual time dropped.
--    A planned index that the planner ignores is wasted — verify, don't assume.
```

## Index type — pick by access pattern

| Type | Use for | Key operators |
|---|---|---|
| **B-tree** (default) | equality, range, sort, unique; ~all scalar columns | `=` `<` `<=` `>=` `>` `BETWEEN` `IN`, prefix `LIKE 'foo%'` |
| **GIN** | JSONB, arrays, full-text (`tsvector`) | `@>` `?` `?|` `?&` (jsonb), `@@` (FTS), `&&` (array) |
| **GiST** | geometry/PostGIS, ranges, nearest-neighbor, exclusion constraints | `&&` `<@` `@>` `<->` |
| **BRIN** | huge tables physically ordered by the column (time-series, append-only logs) | `=` `<` `>` range — tiny index, needs high physical correlation |
| **Hash** | pure equality on non-sortable data (rarely worth it over B-tree) | `=` |

Composite B-tree column order rule: **equality columns first → ORDER BY columns → range/inequality column last.** The first inequality column caps the usable index range; columns after it become filter-only. (PG 18 skip-scan softens this for *low-cardinality* leading columns but is a safety net, not a substitute for ordering.)

## Top anti-patterns → fix

| Anti-pattern | Why it hurts | Fix |
|---|---|---|
| `WHERE lower(email) = ?` on plain index | function defeats the index | expression index: `CREATE INDEX ON t (lower(email))` |
| `WHERE id = '123'` (id is int) | implicit cast → Seq Scan | match the literal/param type to the column |
| `LIKE '%foo%'` | leading wildcard → B-tree unusable | `pg_trgm` GIN index (`gin_trgm_ops`) |
| `OFFSET 10000 LIMIT 20` | scans+discards 10k rows, drifts on insert | keyset: `WHERE id > :last ORDER BY id LIMIT 20` |
| `SELECT *` | blocks index-only scans, wastes I/O | select only needed columns |
| N+1 (query per row) | round-trip storm | one `JOIN` or `WHERE id = ANY($1)` |
| `COUNT(*)` for "is there any" | full scan | `EXISTS (...)`; for approximate totals use `reltuples` |
| huge JSONB blob, hot one key | whole value rewritten every update | extract hot keys to real (or `GENERATED ... STORED`) columns |

## Reference guide — load on demand

| Topic | File | Load when |
|---|---|---|
| Schema & data types | `references/schema.md` | choosing types, PK strategy, constraints, enums vs lookup, generated columns, JSONB-vs-columns |
| Indexing & query tuning | `references/indexing-and-queries.md` | reading EXPLAIN deeply, partial/covering/expression indexes, HOT/fillfactor, extended statistics, work_mem, planner config |
| JSONB | `references/jsonb.md` | JSONB operators, GIN `jsonb_ops` vs `jsonb_path_ops`, query/index patterns |
| Operations | `references/operations.md` | VACUUM/autovacuum, wraparound, connection pooling, config baselines, partitioning, **safe production DDL/migrations**, monitoring, RLS |
| Extensions | `references/extensions.md` | pg_stat_statements, pg_trgm, pgvector, PostGIS, pgcrypto, postgres_fdw, pg_partman |
| Replication & backup | `references/replication-and-backup.md` | streaming/logical replication, PITR, pg_dump vs pg_basebackup, PG 16/17 replication features |

## Hard rules

**MUST**
- Verify index usage with `EXPLAIN (ANALYZE, BUFFERS)` before and after — a created index the planner skips is dead weight.
- Use `CREATE INDEX CONCURRENTLY` and `SET lock_timeout` for production DDL (see `references/operations.md` — lock pileups behind `ACCESS EXCLUSIVE` are the #1 self-inflicted outage).
- Use `timestamptz`, `numeric` for money, `text`, and `GENERATED ... AS IDENTITY` by default.
- Add `NOT NULL` to every column unless NULL is genuinely meaningful; back assumptions with `CHECK`/`UNIQUE`/`FK` constraints.
- Run `ANALYZE` after bulk loads; keep `pg_stat_statements` and autovacuum healthy.
- Use parameterized queries (never string-concatenate user input).
- Put a connection pooler (PgBouncer/Supavisor/PgCat) in front of any web workload.

**MUST NOT**
- Disable autovacuum, or ignore transaction-ID wraparound (`age(relfrozenxid)`).
- `VACUUM FULL` on a live hot table (ACCESS EXCLUSIVE lock) — use `pg_repack` / `REINDEX CONCURRENTLY`.
- Create indexes speculatively — derive them from real query patterns in `pg_stat_statements`.
- Store large blobs in the row/JSONB — use object storage + a reference.
- Use `serial`, `money`, `char(n)`, `timestamp` (without zone), or `uuid-ossp` in new schema.

## Supabase note

This project runs on Supabase Postgres. Two specifics: `gen_random_uuid()` and RLS are first-class there. When writing RLS policies, wrap stable auth calls in a sub-select — `USING (user_id = (SELECT auth.uid()))` — so the planner evaluates them once per statement, not once per row, and index the policy column. Schema changes belong in `supabase/migrations/` (see the `supabase-local` skill for the local CLI workflow), not ad-hoc DDL against prod.
