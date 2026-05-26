# Operations

VACUUM/autovacuum, connection pooling, config baselines, partitioning, **safe production DDL**, monitoring, and Row-Level Security.

## VACUUM & autovacuum

MVCC keeps old row versions ("dead tuples") until VACUUM reclaims them. Skip it and you get bloat, bad plans, and eventually transaction-ID wraparound.

```sql
VACUUM (ANALYZE, VERBOSE) orders;   -- reclaim + refresh stats, non-blocking
-- VACUUM FULL rewrites the table under ACCESS EXCLUSIVE — never on a live hot table.
-- Use pg_repack (online) or REINDEX INDEX CONCURRENTLY for bloat removal instead.
```

**Autovacuum trigger:** `threshold + scale_factor × reltuples`. Defaults: `autovacuum_vacuum_threshold = 50`, `autovacuum_vacuum_scale_factor = 0.2`. The 0.2 default means a 10M-row table waits for ~2M dead tuples before vacuuming — far too lax for high-churn tables. Tune per table:

```sql
ALTER TABLE orders SET (
  autovacuum_vacuum_scale_factor  = 0.02,   -- 2% not 20%
  autovacuum_vacuum_threshold     = 1000,
  autovacuum_analyze_scale_factor = 0.01
);
-- Very high churn (sessions/queues): also autovacuum_vacuum_cost_delay = 0 to stop throttling.
```

PG 18 adds `autovacuum_vacuum_max_threshold` (default 100M — a hard cap on the computed trigger so giant tables vacuum on a bounded dead-tuple count instead of waiting for 0.2 × billions of rows). PG 17 rebuilt VACUUM's dead-tuple store as a radix tree (`TidStore`), cutting its memory use sharply and removing the old 1 GB `maintenance_work_mem`/`autovacuum_work_mem` ceiling — so large tables finish in a single index pass instead of many.

**Transaction-ID wraparound — never ignore:**
```sql
SELECT datname, age(datfrozenxid) FROM pg_database ORDER BY 2 DESC;   -- watch this climb
SELECT relname, age(relfrozenxid) FROM pg_class WHERE relkind IN ('r','m') ORDER BY 2 DESC LIMIT 20;
```
`autovacuum_freeze_max_age` defaults to 200M; anti-wraparound autovacuum **fires even if autovacuum is off** and cannot be skipped. The DB goes read-only ~3M XIDs before the 2.1B limit. If `age()` is in the hundreds of millions and climbing, investigate long-running transactions and replication slots holding back the horizon.

## Connection pooling

Each Postgres backend is a forked process costing several MB + fork overhead; web apps must pool. 

| Pooler | Notes |
|---|---|
| **PgBouncer** | single-threaded, ubiquitous, lowest latency |
| **Supavisor** | Supabase's multi-tenant Elixir pooler (~2ms more latency, built for scale) |
| **PgCat** | Rust, multi-threaded, adds sharding + read-replica load balancing |

`pool_mode`:
- **session** — server held for the client's whole session; everything works; least efficient.
- **transaction** — server returned after each transaction; the default for web workloads; **breaks session-scoped features**: `SET`/`RESET`, session advisory locks (use `pg_advisory_xact_lock`), `LISTEN`/`NOTIFY`, `WITH HOLD` cursors, plain `PREPARE`/`DEALLOCATE`, session temp tables.
- **statement** — per-statement; forbids multi-statement transactions.

PgBouncer 1.21+ (Oct 2023) supports protocol-level prepared statements in transaction mode via `max_prepared_statements` — most drivers' prepared statements now work. It shipped **disabled** (`0`) in 1.21; the default became **200** only in 1.24 (Jan 2025). On 1.21–1.23 you must set it explicitly. Set it ≥ the count of distinct prepared queries.

```ini
[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
max_prepared_statements = 256
```

## Config baselines (dedicated server; defaults ship conservative)

| Parameter | Recommended | Note |
|---|---|---|
| `shared_buffers` | ~25% RAM | restart required; OS cache handles the rest |
| `effective_cache_size` | 50–75% RAM | planner hint only, allocates nothing |
| `work_mem` | modest (4–64 MB) global; raise per-query | per node × connection × parallel worker — see indexing-and-queries.md |
| `maintenance_work_mem` | 256 MB–1 GB | speeds VACUUM/CREATE INDEX; `autovacuum_work_mem` caps autovac workers |
| `random_page_cost` | **1.1** (SSD/NVMe) | default 4.0 over-penalizes index scans |
| `effective_io_concurrency` | PG 18 default **16**; raise for high-IOPS SSD | prefetch/AIO depth — the old "~200" advice predates PG 18 async I/O |
| `max_wal_size` | 2–8 GB (default 1 GB) | larger = fewer checkpoints |
| `checkpoint_completion_target` | 0.9 (the default since PG 14) | spread checkpoint writes |
| `wal_compression` | `lz4`/`zstd` (default `off`) | less WAL for minor CPU |
| `idle_in_transaction_session_timeout` | `30s`–`5min` | kill abandoned open txns that block VACUUM + pin locks (default `0` = off) |
| `statement_timeout` | per-workload | cap runaway queries; set per-role/session, not a global non-zero |

[pgtune.leopard.in.ua](https://pgtune.leopard.in.ua) is a reasonable starting point; always validate under real load. (On managed Postgres / Supabase these are set for the instance class — tune per-query and per-table instead.)

> PG 18 introduces asynchronous I/O (`io_method` = `worker` by default, `io_uring` on Linux builds with liburing, or `sync` for the old behavior) and raised `effective_io_concurrency`'s default from 1 to 16. On PG 18, prefer the new AIO knobs (`io_combine_limit`) over hand-tuning prefetch to legacy values.

## Partitioning (declarative, PG 10+)

```sql
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2026_q1 PARTITION OF events
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE events_default PARTITION OF events DEFAULT;   -- catch-all
CREATE INDEX ON events (created_at);   -- inherited by all partitions (PG 11+)
```

- **RANGE** (time/numeric), **LIST** (discrete values), **HASH** (even spread).
- **Pruning only works when the query filters on the partition key.** UNIQUE/PK must include the partition key.
- **DETACH … CONCURRENTLY** (PG 14+) drops a partition without `ACCESS EXCLUSIVE` (great for rolling retention — detach then drop).
- **Fast ATTACH:** pre-add a `CHECK` matching the bounds so `ATTACH PARTITION` skips the validation scan.
- Automate creation/retention with **pg_partman**.
- When: typically tens-to-hundreds of GB, or when you bulk-delete history (drop a partition vs `DELETE`). Too many partitions inflates planning time — don't over-partition OLTP.

## Safe production DDL — avoid lock pileups

The failure mode: a statement waiting for `ACCESS EXCLUSIVE` queues, and every query behind it queues too — a brief operation cascades into an outage. Always:

```sql
SET lock_timeout = '3s';   -- fail fast instead of pile-up; retry rather than block everyone
```

- **Indexes:** `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` / `REINDEX INDEX CONCURRENTLY` — `SHARE UPDATE EXCLUSIVE`, can't run inside a txn block, may leave an `INVALID` index on failure (drop and retry).
- **Add column with default:** instant since PG 11 for non-volatile defaults (stored as metadata, no rewrite). A `volatile` default (e.g. `clock_timestamp()`) still rewrites.
- **NOT NULL on a big table:** `ADD CONSTRAINT chk CHECK (col IS NOT NULL) NOT VALID` → `VALIDATE CONSTRAINT chk` → `ALTER COLUMN col SET NOT NULL`.
- **FK/CHECK:** add `NOT VALID`, then `VALIDATE CONSTRAINT` (see schema.md).
- **Type change that alters on-disk format** (`int`→`bigint`) rewrites the table under lock — use a shadow column + backfill + trigger + swap instead.

On Supabase, put all of this in `supabase/migrations/` and apply via the CLI (see the `supabase-local` skill) — don't run ad-hoc DDL on prod.

## Monitoring

```sql
-- Enable first (postgresql.conf, needs restart):
--   shared_preload_libraries = 'pg_stat_statements'
--   compute_query_id = on
-- then: CREATE EXTENSION pg_stat_statements;

-- Top time sinks (PG 13+ columns!)
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;

-- Cache hit ratio (>99% healthy)
SELECT round(100.0*sum(blks_hit)/NULLIF(sum(blks_hit)+sum(blks_read),0),2) AS hit_ratio
FROM pg_stat_database;

-- Unused indexes (dead weight; drop after confirming across a full traffic cycle)
SELECT schemaname, relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Dead-tuple bloat
SELECT relname, n_dead_tup, n_live_tup,
       round(100.0*n_dead_tup/NULLIF(n_live_tup+n_dead_tup,0),1) AS dead_pct, last_autovacuum
FROM pg_stat_user_tables WHERE n_dead_tup > 1000 ORDER BY dead_pct DESC;

-- Long-running & idle-in-transaction (the latter block autovacuum + hold locks)
SELECT pid, now()-query_start AS dur, state, query FROM pg_stat_activity
WHERE state IN ('active','idle in transaction') AND now()-query_start > interval '5 min'
ORDER BY dur DESC;

-- Who is blocking whom
SELECT b.pid AS blocked, b.query AS blocked_q, k.pid AS blocking, k.query AS blocking_q
FROM pg_stat_activity b
JOIN pg_stat_activity k ON k.pid = ANY(pg_blocking_pids(b.pid))
WHERE cardinality(pg_blocking_pids(b.pid)) > 0;

-- Cancel / terminate
SELECT pg_cancel_backend(pid);     -- gentle (cancels current query)
SELECT pg_terminate_backend(pid);  -- forceful (drops the connection)
```

## Row-Level Security

```sql
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
-- Owners bypass RLS unless you also:
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_rw ON accounts
  FOR ALL TO authenticated
  USING      (user_id = (SELECT auth.uid()))    -- visibility (read / row filter)
  WITH CHECK (user_id = (SELECT auth.uid()));   -- allowed writes
```

- Enabling RLS with **no policy = default deny** (catches the "forgot a policy" mistake).
- **Permissive** policies combine with `OR`; **restrictive** (`AS RESTRICTIVE`) with `AND`; the two sets are then AND-ed.
- `USING` filters existing rows; `WITH CHECK` validates written values; `USING`-only applies to both.
- **Performance:** policy expressions run **per row**. Wrap stable functions in a sub-select — `(SELECT auth.uid())` not `auth.uid()` — so they evaluate once per statement. **Index the policy column.** Scope policies with `TO <role>`. Still pass an explicit `WHERE user_id = …` from the app so the planner builds a good plan rather than leaning on the policy alone.
