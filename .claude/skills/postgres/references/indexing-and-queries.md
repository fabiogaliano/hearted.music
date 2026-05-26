# Indexing & Query Tuning

## Reading EXPLAIN ANALYZE

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)   -- add WAL for write queries; FORMAT JSON for visualizers
SELECT ...;
```

What each line tells you:

```
Seq Scan on orders  (cost=0.00..18334.00 rows=10000 width=32)
                     │              │      │             └ avg row bytes
                     │              │      └ planner's row estimate
                     └ startup..total estimated cost (arbitrary units)
  (actual time=0.012..52.3 rows=9876 loops=1)
              │            │         └ times this node ran (×N in a nested loop)
              │            └ ACTUAL rows returned
              └ time to first row .. time to last row
  Buffers: shared hit=120 read=4500          -- hit=cache (fast), read=disk (slow)
```

Triage signals, in priority order:
1. **Estimate vs actual rows off by >10×** → stale or insufficient statistics. `ANALYZE` the table; consider extended statistics (below) for correlated columns. Bad estimates cause every downstream node to pick the wrong strategy.
2. **Seq Scan on a large table** with a selective filter → missing/unusable index.
3. **Sort / HashAggregate "external merge Disk: …kB"** → spilled to disk; raise `work_mem` for that query.
4. **Nested Loop** with a large outer row count → missing index on the inner join key, or a row underestimate.
5. **High `read` vs `hit`** → cold cache or working set exceeds `shared_buffers`.

Node speed, roughly best→worst for point/range lookups: Index Only Scan > Index Scan > Bitmap Index Scan > Seq Scan. A Seq Scan is *fine* (often optimal) for small tables or when returning most rows.

## Composite (multi-column) index ordering

PostgreSQL docs rule: equality constraints on leading columns, **plus the inequality on the first non-equality column**, bound the scanned index range. Everything to the right is only a *filter* (checked, but doesn't narrow the scan).

Order: **equality cols → ORDER BY cols → range/inequality col last.**

```sql
-- WHERE a = 1 AND b > 10 AND c = 5
-- Index (a,b,c): a= and b> bound the scan; c= is filter-only.
-- Index (a,c,b): a= and c= both bound the scan; b> is the trailing range. ← better
CREATE INDEX ON t (a, c, b);
```

Matching `ORDER BY` to index order avoids a separate Sort node: `(user_id, created_at DESC)` serves `WHERE user_id = ? ORDER BY created_at DESC LIMIT n` with no sort.

PG 18 **skip scan** lets `(a, b)` help a `WHERE b = ?` query by enumerating distinct `a` values — but only pays off when `a` is *low-cardinality*. Design indexes for your real access patterns; treat skip scan as a fallback that reduces the need for redundant permutation indexes.

## Specialized index forms

- **Partial** — index a subset: `CREATE INDEX ON orders (created_at) WHERE status = 'pending'`. Smaller, faster; usable only when the query's WHERE implies the predicate. Great for soft-delete (`WHERE deleted_at IS NULL`) and partial unique constraints.
- **Expression** — `CREATE INDEX ON users (lower(email))`; the query must use the identical expression. Recomputed on every non-HOT write.
- **Covering / INCLUDE** — `CREATE INDEX ON t (x) INCLUDE (y, z)`; lets `SELECT y,z WHERE x=?` be answered from the index (index-only scan). `INCLUDE` columns aren't part of the key (no ordering/uniqueness).

**Index-only scans depend on the visibility map.** A row is returned from the index without a heap fetch only if its heap page is marked all-visible in the VM. Heavily-written tables have unset VM bits until VACUUM runs, so index-only scans silently degrade to heap fetches. Keep autovacuum aggressive on high-write tables to preserve the benefit.

## B-tree internals worth knowing

- **Deduplication (PG 13+, default on):** collapses duplicate keys into posting lists — much smaller indexes on low-cardinality columns and FKs. It *is* used on unique indexes too (to absorb MVCC version churn and buy time for bottom-up deletion); it's auto-disabled only on indexes with `INCLUDE` (non-key) columns.
- **Bottom-up index deletion (PG 14+):** clears dead index entries from a leaf before splitting it, slashing bloat on tables with frequent updates to indexed columns.

## HOT updates & fillfactor

A **HOT** (Heap-Only Tuple) update avoids touching any index when (1) no indexed column changed and (2) the new tuple fits on the same page. It also lets dead versions be reclaimed without VACUUM. This is the single biggest update-throughput lever. (PG 16+: changing a column covered *only* by a BRIN summarizing index still qualifies for HOT.)

```sql
-- Leave free space per page so updates stay on-page → more HOT updates.
ALTER TABLE sessions SET (fillfactor = 80);   -- 70–90 for write-heavy; 100 (default) for read-heavy
-- Then rewrite to apply to existing data: VACUUM FULL / pg_repack / table rewrite.

-- Measure: ratio near 1.0 is good.
SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / NULLIF(n_tup_upd,0), 1) AS hot_pct
FROM pg_stat_user_tables ORDER BY n_tup_upd DESC;
```

Low HOT ratio → either you're updating indexed columns (reconsider which columns are indexed) or pages are full (lower fillfactor). Don't lower fillfactor on read-heavy tables; it just inflates the table and slows scans.

## Extended statistics for correlated columns

The planner assumes columns are independent and multiplies selectivities, badly underestimating correlated predicates:

```sql
-- a and b are identical here; planner estimates rows=1, actual=100.
CREATE STATISTICS s_ab (dependencies, ndistinct, mcv) ON a, b FROM t;
ANALYZE t;
```

- `dependencies` — fixes equality-predicate underestimates from functional dependency (cheapest).
- `ndistinct` — fixes `GROUP BY (a,b)` cardinality.
- `mcv` — most-common combinations; handles inequalities and impossible combos (`a=1 AND b=10` → 0 rows). Most powerful, most expensive.

Create only for column sets that actually appear together in predicates and where EXPLAIN shows estimate divergence.

## Upserts: ON CONFLICT vs MERGE

```sql
-- Simple, concurrency-safe upsert keyed on a unique constraint:
INSERT INTO counters (id, n) VALUES ($1, 1)
ON CONFLICT (id) DO UPDATE SET n = counters.n + 1;

-- MERGE (PG 15+): multi-branch logic / NOT MATCHED BY SOURCE deletes.
-- RETURNING in MERGE: PG 17+. OLD/NEW in RETURNING: PG 18.
MERGE INTO target t USING source s ON t.id = s.id
WHEN MATCHED AND s.deleted THEN DELETE
WHEN MATCHED THEN UPDATE SET val = s.val
WHEN NOT MATCHED THEN INSERT (id, val) VALUES (s.id, s.val);
```

Prefer `ON CONFLICT` for single-table high-concurrency upserts: its speculative insertion is concurrency-safe within one statement. **`MERGE` is not** — a concurrent `INSERT` between MERGE's match check and its write can still raise a unique-violation (MERGE has no `ON CONFLICT`-style retry). Use `MERGE` for multi-branch conditional insert/update/delete in one pass, not as a high-concurrency upsert. They are not interchangeable.

## Pagination, window functions, recursion

```sql
-- Keyset (cursor) pagination — O(log n) regardless of depth. Needs a deterministic key.
-- Row-value comparison works ONLY when every sort key shares one direction (all DESC here);
-- for mixed DESC/ASC, expand to (a < $1) OR (a = $1 AND b > $2) by hand.
SELECT * FROM products WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC LIMIT 20;

-- Window analytics without self-joins.
SELECT product_id, sale_date, amount,
       sum(amount)  OVER (PARTITION BY product_id ORDER BY sale_date) AS running_total,
       lag(amount)  OVER (PARTITION BY product_id ORDER BY sale_date) AS prev_amount
FROM sales;

-- Recursive CTE for trees.
WITH RECURSIVE tree AS (
  SELECT id, parent_id, 1 AS depth FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, t.depth + 1 FROM categories c JOIN tree t ON c.parent_id = t.id
) SELECT * FROM tree;
```

## work_mem & planner cost settings

- `work_mem` is **per sort/hash node, per connection** — and each parallel worker gets its own copy. Peak ≈ `work_mem × concurrent nodes × connections`. A "safe" global of 4–64 MB plus per-query `SET LOCAL work_mem = '256MB'` for known-heavy analytics beats one large global value. Set `log_temp_files = 0` to catch spills.
- `hash_mem_multiplier` (default 2.0 since PG 15) lets hash nodes use more than `work_mem`; raise to 4–8 if hash joins/aggregates spill.
- `random_page_cost = 1.1` on SSD/NVMe (default 4.0 assumes spinning disk and over-penalizes index scans). `seq_page_cost` stays 1.0. Settable per-tablespace.
- After changing planner GUCs, re-check with `EXPLAIN (ANALYZE, SETTINGS)` — `SETTINGS` shows which non-defaults shaped the plan.
