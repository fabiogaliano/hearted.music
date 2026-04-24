---
name: supabase-local
description: Query and write to the local Supabase Postgres database without MCP. Reads go through the container's psql (handles enums natively); writes go through `supabase db query` (keeps the agent safety envelope). Defaults to local only; never touches prod unless explicitly opted in. Triggers when the user asks to run SQL, inspect a table/schema, check RLS, create or apply a migration, reset the local db, or diff schema changes.
---

# Supabase Local DB (CLI-only, no MCP)

Interact with the local Supabase Postgres (Docker container at `127.0.0.1:54322`) using only tools already on the machine: the `supabase` CLI, the `psql` inside the running container, and the `postgres` npm package already in `package.json`. No MCP. No `libpq`/`psql` on the host. No `pgcli`.

## Hard rules

1. **Never touch production.** Do not pass `--linked` or a custom `--db-url` without explicit, same-turn human approval. Local is the only mode allowed unsupervised.
2. **Destructive writes need confirmation.** `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without `WHERE` — show the exact statement and wait for a yes before executing, even on local.
3. **Schema changes go through migrations.** If a change must persist across teammates or survive `supabase db reset`, create a file in `supabase/migrations/`. Don't run DDL ad hoc against the live db.
4. **Never run `supabase db push`** unless the user names it. It promotes local migrations to the linked remote.

## Tool ranking at a glance

| Intent | Tool | Why |
|---|---|---|
| Read rows / schema | `docker exec … psql` | Handles custom enums natively; supports `\d`, `--csv`, JSON via `json_agg` |
| Write (INSERT/UPDATE/DELETE/DDL) | `supabase db query --local` | Keeps agent safety envelope; use `::text` casts if any `RETURNING` column is a custom enum |
| Repeatable / typed / parameterized SQL | Bun script using `postgres` (Porsager) | Already a dep; returns JS objects; tagged templates prevent injection |
| Migrations | `supabase migration new` + `supabase db reset` | Only way changes survive reset and reach teammates |

Never reach for a host `psql` install, `pgcli`, or MCP. None adds anything over the options above.

## Preflight

```sh
supabase status -o env | grep -E '^(DB_URL|API_URL)='
```

If the stack isn't running, tell the user and wait — don't auto-`supabase start` (~15s cold boot, side effects).

## Reading

Default tool for reads: the container's psql. No enum hiccups, supports `\d`-family introspection, and handles every output shape an agent needs.

**Container name pattern:** `supabase_db_<project_id>` — here that's `supabase_db_v1_hearted`.

### Table output (human review)
```sh
docker exec supabase_db_v1_hearted psql -U postgres -d postgres -c \
  "SELECT type, status, COUNT(*) FROM job GROUP BY 1, 2"
```

### CSV (smallest token footprint for many rows)
```sh
docker exec supabase_db_v1_hearted psql -U postgres -d postgres --csv -c \
  "SELECT type, status, COUNT(*) FROM job GROUP BY 1, 2"
```

### JSON (structured output for agent reasoning)
```sh
docker exec supabase_db_v1_hearted psql -U postgres -d postgres -A -t -c \
  "SELECT json_agg(row_to_json(t)) FROM (SELECT type, status, COUNT(*) AS count FROM job GROUP BY 1, 2) t"
```

Flags: `-A` unaligned, `-t` no header/footer — together they strip formatting so the output is a single clean JSON string.

### Multi-statement SQL from a file
```sh
docker exec -i supabase_db_v1_hearted psql -U postgres -d postgres < scripts/sql/inspect-playlists.sql
```

### Interactive REPL (for exploration)
```sh
docker exec -it supabase_db_v1_hearted psql -U postgres
# then: \dt, \d song, \df, \dn+, \dp song, \dT+ (list enums)
```

## Writing

Use `supabase db query --local` (the default) — it keeps the agent safety envelope and refuses to touch remote without explicit opt-in.

### Single statement
```sh
supabase db query "UPDATE account SET onboarded = true WHERE id = '...'"
```

### Multi-statement from a file
Always review with the user first. Wrap in a transaction so partial failures roll back:
```sql
-- scripts/sql/backfill-artist-images.sql
BEGIN;
UPDATE ...;
INSERT ...;
COMMIT;
```
```sh
supabase db query --file scripts/sql/backfill-artist-images.sql
```

### Enum gotcha on writes

`supabase db query` uses the `pgx` Go driver, which refuses to decode custom enum OIDs unless they're registered at connect time (Supabase CLI doesn't register them). This is a permanent upstream constraint, not a bug that'll be fixed.

It breaks any query that **returns** an enum column — so `RETURNING type, status` on the `job` table fails with `unknown oid NNNNN cannot be scanned into *interface {}`. Fix: cast each enum column to `::text` in `RETURNING`.

```sh
supabase db query "INSERT INTO job (account_id, type) VALUES ('...', 'enrichment') RETURNING id, type::text, status::text"
```

If the write doesn't need `RETURNING`, no casts needed. If it does and casts feel awkward (e.g. many columns), do the write in a Bun script (next section).

## Scripted / repeatable / parameterized SQL (Bun + `postgres`)

The project already ships `postgres` (Porsager) 3.4.8 — a modern tagged-template Postgres driver. Use it for anything that:
- runs more than once,
- needs user-supplied parameters (safe via tagged templates),
- returns data you want as typed JS objects, or
- has complex enum `RETURNING` clauses.

### Minimal template (`scripts/sql/<name>.ts`)

```ts
#!/usr/bin/env bun
import postgres from "postgres"

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres")

try {
  // read
  const jobs = await sql`
    SELECT id, type, status, created_at
    FROM job
    WHERE status = ${"pending"}
    ORDER BY created_at DESC
    LIMIT 10
  `
  console.log(JSON.stringify(jobs, null, 2))

  // write in a transaction
  await sql.begin(async (tx) => {
    await tx`UPDATE account SET onboarded = true WHERE id = ${accountId}`
    await tx`INSERT INTO job (account_id, type) VALUES (${accountId}, 'enrichment')`
  })
} finally {
  await sql.end()
}
```

Run with `bun run scripts/sql/<name>.ts`. `postgres` decodes enums as strings natively — no casts, no OID dance. Tagged-template interpolation is parameterized, not string-concatenated, so it's injection-safe.

## Schema inspection

Lead with `psql` backslash commands. Fall back to `pg_catalog` / `information_schema` queries only when you need machine-readable schema data (e.g. to drive another script).

### Interactive REPL
```sh
docker exec -it supabase_db_v1_hearted psql -U postgres
```
```
\dt public.*       -- list tables
\d  job            -- describe table (columns, types, defaults, indexes, constraints)
\dT+ public.*      -- list custom types (enums, domains, composites)
\df public.*       -- list functions
\dp song           -- access privileges + RLS
\dn+               -- schemas
```

### One-shot (same output, non-interactive)
```sh
docker exec supabase_db_v1_hearted psql -U postgres -d postgres -c "\d job"
```

### Machine-readable (when feeding into another step)
```sh
docker exec supabase_db_v1_hearted psql -U postgres -d postgres -A -t -c \
  "SELECT json_agg(row_to_json(c)) FROM (
     SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='song'
     ORDER BY ordinal_position
   ) c"
```

## RLS policies

Inspect:
```sh
docker exec supabase_db_v1_hearted psql -U postgres -d postgres -c \
  "SELECT schemaname, tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public'"
```

Or interactively: `\dp <table>` shows access privileges + policies.

Add or modify policies — always via a migration file. Never ad hoc.

## Migrations

Create a new migration:
```sh
supabase migration new add_playlist_index
```

Edit `supabase/migrations/<timestamp>_add_playlist_index.sql`, then apply locally:
```sh
supabase db reset
```
`db reset` re-runs every migration and `supabase/seed.sql`.

Derive a migration from changes made directly to the local db (Studio edits, etc. — prefer hand-written migrations when practical):
```sh
supabase db diff -f describe_your_change
```

Lint pending migrations:
```sh
supabase db lint
```

Migrations in `supabase/migrations/` are **immutable once committed**. To change one, add a new migration that supersedes it.

## Seed data

`supabase/seed.sql` runs after every `supabase db reset`. Treat it as a reproducible fixture — not a dump of live state. Make seed rows idempotent: `INSERT ... ON CONFLICT DO NOTHING`.

## Project invariants this skill assumes

- Migrations: `supabase/migrations/` — naming `YYYYMMDDHHMMSS_description.sql`
- Seed: `supabase/seed.sql`
- Config: `supabase/config.toml` (ports live here)
- Local DB URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- DB container: `supabase_db_v1_hearted` (pattern: `supabase_db_<project_id>`)
- Postgres version: 17
- Studio (for humans only): http://127.0.0.1:54323
- Known custom enums: `job_type`, `job_status` (check `\dT+ public.*` for the full list — values aren't always visible in live data)

## Anti-patterns

- Installing `psql`/`libpq` on the host — duplicates the binary already inside the container.
- Installing `pgcli` — it's a human UX tool; adds nothing for scripted/agent use.
- Using `supabase db query` for reads when the result includes custom enum columns — will fail on OID decode.
- Re-enabling the Supabase MCP.
- Editing a committed migration in place.
- Running `supabase db push` on the agent's initiative.
- Making schema changes through Studio rather than a migration file.
