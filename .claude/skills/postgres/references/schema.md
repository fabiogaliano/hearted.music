# Schema & Data-Type Design

Correctness lives in the schema. A good type/constraint choice prevents whole classes of bugs that no application code can fully recover from. Most of this codifies the PostgreSQL wiki "Don't Do This" page plus current consensus.

## Data type choices

| Need | Use | Avoid & why |
|---|---|---|
| Text | `text` | `char(n)` (blank-padded to `n` *on disk* → **more** storage + slower, never a win); `varchar(n)` with arbitrary limits (rewrite-to-relax). `text` and `varchar` share identical storage — pick `text` and enforce length with `CHECK (char_length(col) <= n)` only when a real cap exists. |
| Point in time | `timestamptz` | `timestamp` — stores a "picture of a clock" with no zone; two clients in different zones become uncomparable. |
| Time of day with offset | `time` or `(date, time)` | `timetz` — the docs themselves say don't use it. |
| Money / exact decimal | `numeric(p,s)` or integer cents (`bigint`) | `money` (locale-tied — precision/format follow `lc_monetary`, so dumps break across locales); `float`/`double` (binary FP can't represent decimals exactly — never for money). |
| Boolean | `boolean` | integer flags. |
| Enumerated set | `enum`, lookup table, or `CHECK` (see below) | — |
| Dynamic/sparse attrs | `jsonb` | `json` (text, unindexable); EAV tables. |

`timestamptz` stores 8 bytes of UTC microseconds — it does **not** retain the input zone; it converts on write and renders in the session `timezone` on read. `now()` and `CURRENT_TIMESTAMP` both return transaction-start time; use `clock_timestamp()` for mid-transaction wall-clock.

Range gotcha: `BETWEEN '2024-01-01' AND '2024-01-08'` is a *closed* interval and includes exactly midnight on the 8th — double-counts at boundaries. Use `>= start AND < exclusive_end` for time ranges.

## Primary key strategy

| Option | Size | Locality | Distributed gen | Use when |
|---|---|---|---|---|
| `bigint GENERATED ALWAYS AS IDENTITY` | 8 B | excellent (sequential) | no (central sequence) | single-writer, highest throughput, smallest index; default for internal tables |
| `uuid` v7 (`uuidv7()`, PG 18) | 16 B | good (time-ordered prefix) | yes | need opaque IDs or client/distributed generation, want index locality |
| `uuid` v4 (`gen_random_uuid()`) | 16 B | poor (random → page splits, bloat) | yes | only when creation-time must not leak (v7 embeds a timestamp) |

- **`serial`/`bigserial` are legacy.** `GENERATED ALWAYS AS IDENTITY` is SQL-standard, ties the sequence to the table (dump/permissions/ownership behave), and blocks accidental manual inserts (override with `OVERRIDING SYSTEM VALUE`). Use `BY DEFAULT` instead of `ALWAYS` only if you must insert explicit values (e.g. data import).
- **`uuid-ossp` is legacy.** `gen_random_uuid()` is built into core since PG 13; `uuidv7()`/`uuidv4()` since PG 18.
- v4 UUID keys insert randomly across the B-tree, causing page splits, ~30% wasted page space, and extra WAL. v7 fixes this by leading with a 48-bit millisecond timestamp plus 12 bits of sub-millisecond precision (so even same-millisecond inserts stay ordered) before the random tail. Prefer v7 for new write-heavy tables that need UUIDs; prefer `bigint` identity when you don't need the UUID properties.

## Enumerated values: enum vs lookup table vs CHECK

| | `enum` | Lookup table (FK) | `CHECK` constraint |
|---|---|---|---|
| Storage | 4 B | FK column + join | raw value |
| Add value | `ALTER TYPE ... ADD VALUE` (no rewrite) | `INSERT` | swap constraint |
| Remove/reorder | ✗ (can't remove; reorder needs recreate) | ✓ free | ✓ |
| Extra metadata (label, sort, active) | ✗ | ✓ | ✗ |
| Runtime-managed by app users | ✗ | ✓ | ✗ |

Consensus: **enum** when the set is stable and you'll never delete values; **CHECK** when the set evolves or needs cross-column logic; **lookup table** when values carry metadata or must be editable at runtime. Caveat: `ALTER TYPE ... ADD VALUE` cannot be used and then referenced in the *same* transaction.

## Constraints = enforced correctness

- **NOT NULL** on everything unless absence is a real, distinct state. NULL silently poisons arithmetic, `=`, and `NOT IN`.
- **CHECK** for row-level invariants: `CHECK (end_ts > start_ts)`, `CHECK (status IN (...))`. Immutable expressions only; cannot reference other tables.
- **FOREIGN KEY** — choose `ON DELETE` deliberately: `CASCADE` (dependent children, GDPR delete), `SET NULL` (optional ref), `RESTRICT`/`NO ACTION` (default, safest).
- **UNIQUE** auto-creates a B-tree index; permits multiple NULLs (NULLs aren't equal) — add `NULLS NOT DISTINCT` (PG 15+) when you need at most one NULL. Use a partial unique index for conditional uniqueness: `CREATE UNIQUE INDEX ON t (email) WHERE deleted_at IS NULL`.
- **EXCLUDE** (GiST) for "no two rows may overlap" — the canonical no-double-booking constraint (needs `btree_gist` to mix `=` with a range `&&`):
  ```sql
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE reservations
    ADD CONSTRAINT no_overlap
    EXCLUDE USING gist (room_id WITH =, during WITH &&);
  ```
  PG 18 also adds SQL-standard **temporal** keys — `PRIMARY KEY`/`UNIQUE`/`FOREIGN KEY (... , period WITHOUT OVERLAPS)` — for built-in non-overlapping-range integrity without hand-rolling the GiST exclusion constraint.

### Adding constraints to large live tables without a long lock

Plain `ADD CONSTRAINT` takes `ACCESS EXCLUSIVE` and full-scans the table. Split it:

```sql
-- 1. Add NOT VALID: enforced for NEW/changed rows immediately, no full scan, brief lock.
ALTER TABLE orders
  ADD CONSTRAINT fk_customer FOREIGN KEY (customer_id) REFERENCES customers(id) NOT VALID;

-- 2. Validate existing rows separately under SHARE UPDATE EXCLUSIVE (reads + writes continue).
ALTER TABLE orders VALIDATE CONSTRAINT fk_customer;
```

Same two-step works for `CHECK`. For `NOT NULL` on a big table: add `CHECK (col IS NOT NULL) NOT VALID`, `VALIDATE`, then `ALTER COLUMN ... SET NOT NULL` (fast, PG 12+ reuses the validated check). See `references/operations.md` for the full safe-migration playbook.

## Generated columns

```sql
-- STORED: computed on write, persisted, INDEXABLE.
CREATE TABLE products (
  price          numeric,
  price_with_tax numeric GENERATED ALWAYS AS (price * 1.19) STORED
);

-- Promote a hot JSONB key to a real, indexable column.
ALTER TABLE documents
  ADD COLUMN title text GENERATED ALWAYS AS (data ->> 'title') STORED;
CREATE INDEX ON documents (title);
```

- Expression must be immutable and can't reference subqueries, other generated columns, or system columns (except `tableoid`). `STORED` permits user-defined immutable functions; `VIRTUAL` does not (see below).
- **VIRTUAL** generated columns arrive in PG 18 (computed on read, not stored) and become the default form when neither keyword is given — but they **cannot be indexed yet** and may reference **only built-in functions/types** (no user-defined functions or types). Use `STORED` when you need an index or a UDF in the expression.

## JSONB vs normalized columns

Default to real columns; reach for JSONB only when structure is genuinely dynamic.

**Use real columns** when data is queried/filtered/joined/updated often, needs typing, constraints, or planner statistics (JSONB comparisons are type-sensitive: `"123" ≠ 123`).

**Use JSONB** for sparse/per-row-variable attributes or semi-structured documents. Best as a hybrid: normalized core columns + one `jsonb` column for supplementary attributes.

TOAST reality: JSONB uses `EXTENDED` storage; rows over ~2 KB get compressed and stored out-of-line. **Updating one key rewrites the entire JSONB value** (and re-TOASTs it). Keep documents small; extract hot/large keys to columns. Never store big blobs (images, files) in the row.
