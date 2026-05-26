# JSONB

Use `jsonb` (binary, indexable), never `json` (stored as text — no GIN operator classes, so containment/key-existence can't be index-accelerated; only expression indexes work) — unless you must preserve exact whitespace/key order. First decide JSONB-vs-columns (see `references/schema.md`): real columns win whenever the data is structured, typed, frequently queried, or updated.

## Operators

```sql
-- Access
data -> 'user'                 -- → jsonb
data ->> 'status'              -- → text
data #> '{user,address,city}'  -- → jsonb (nested path)
data #>> '{user,address,city}' -- → text  (nested path)
data -> 'tags' -> 0            -- array element

-- Containment & existence (these are what GIN accelerates)
data @> '{"status":"active"}'  -- contains (the workhorse filter)
data ? 'email'                 -- key exists
data ?| array['email','phone'] -- any key exists
data ?& array['email','phone'] -- all keys exist
data @? '$.items[*] ? (@.price > 100)'  -- jsonpath exists (PG 12+)

-- Modify
data || '{"k":"v"}'::jsonb               -- shallow merge
data - 'key'                             -- remove key
data #- '{user,tmp}'                     -- remove nested path
jsonb_set(data, '{user,email}', '"x@y"') -- deep set
```

## Indexing strategy — choose the narrowest that covers your queries

```sql
-- 1. Default GIN (jsonb_ops): supports @>, @?, @@, ?, ?|, ?&. Largest; only class that does key-existence (?, ?|, ?&).
CREATE INDEX ON documents USING GIN (data);

-- 2. GIN jsonb_path_ops: supports @>, @?, @@ only (NO ?/?|/?& key-existence). Smaller & faster for containment.
CREATE INDEX ON documents USING GIN (data jsonb_path_ops);

-- 3. Expression B-tree on a hot scalar path: best for equality/range/sort on one field.
CREATE INDEX ON documents ((data ->> 'status'));
CREATE INDEX ON documents (((data -> 'user' ->> 'id')::int));

-- 4. Best for a frequently-filtered field: promote it to a STORED generated column + B-tree.
ALTER TABLE documents ADD COLUMN status text GENERATED ALWAYS AS (data ->> 'status') STORED;
CREATE INDEX ON documents (status);
```

Rule of thumb: **containment search across many keys → `jsonb_path_ops` GIN. Equality/range/sort on one known key → expression index or (better) a generated column.** `jsonb_path_ops` can't index empty objects, so a query hitting only `{}` rows falls back to a scan.

## Query patterns

```sql
-- Filter (GIN-accelerated)
SELECT * FROM documents WHERE data @> '{"status":"active","verified":true}';
SELECT * FROM documents WHERE data -> 'user' @> '{"role":"admin"}';
SELECT * FROM documents WHERE data -> 'tags' @> '["postgres"]';

-- Expand an array to rows
SELECT id, jsonb_array_elements_text(data -> 'tags') AS tag FROM documents;

-- Aggregate
SELECT data ->> 'status' AS status, count(*)
FROM documents GROUP BY data ->> 'status';

-- jsonpath with filter (PG 12+)
SELECT jsonb_path_query(data, '$.items[*] ? (@.price > 100)') FROM documents;
```

## SQL/JSON (PG 16–17) — prefer over manual unnesting

PG 16 added the `IS JSON` predicate and the `JSON_OBJECT`/`JSON_ARRAY`(`AGG`) constructors. PG 17 added the big one — **`JSON_TABLE`**, which projects JSON into a relational result inside `FROM`, plus `JSON_QUERY`/`JSON_VALUE`/`JSON_EXISTS` and jsonpath type methods (`.integer()`, `.string()`, `.date()`, …). On PG 17+, `JSON_TABLE` replaces brittle `jsonb_array_elements` + `LATERAL` + per-key casts.

```sql
-- Shred an array of objects into typed rows (PG 17+).
SELECT t.*
FROM documents d,
     JSON_TABLE(d.data, '$.items[*]'
       COLUMNS (sku text PATH '$.sku', price numeric PATH '$.price')) AS t;
```

## Validation

```sql
ALTER TABLE documents ADD CONSTRAINT data_shape CHECK (
  jsonb_typeof(data) = 'object'
  AND data ? 'id'
  AND data ->> 'status' IN ('active','pending','archived')
);
```

## Pitfalls

- Don't mix types in containment: `data @> '{"score":"100"}'` (string) won't match a numeric `100`. Cast instead: `(data->>'score')::int = 100`.
- Don't filter on a deep path with no matching index — add an expression index on that exact path or a generated column.
- Don't store 10k-element arrays or large blobs in JSONB — use a child table or object storage.
- A single-key update rewrites and re-TOASTs the whole document; keep documents small and extract hot/large keys.
