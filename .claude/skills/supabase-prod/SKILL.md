---
name: supabase-prod
description: Run reads and writes against the PRODUCTION Supabase database (now SELF-HOSTED on the Coolify VPS at supabase.hearted.music) using `bun run prod:rest` (PostgREST + service-role) and `bun run prod:sql` (direct Postgres). The prod counterpart to supabase-local. Use whenever the task involves querying, inspecting, counting, updating, or deleting production data — e.g. "how many users in prod", "look up a prod account", "delete a user from prod", "run this SQL against prod", "check a row in production". Covers which mode to pick, the safety model, and FK-cascade behavior for deletes. Triggers on: prod/production database, prod data, query prod, prod users/accounts, delete from prod, run SQL on prod, prod:sql, prod:rest.
---

# Prod DB ops

One tool — `scripts/db/prod.ts`, exposed as two bun scripts — for talking to the
**production** database, which is now the **self-hosted** Supabase
(`https://supabase.hearted.music`) on the Coolify VPS, not the old hosted project
(see `scripts/db/migrate/README.md` for the cutover). REST creds are already on
disk; SQL mode needs `PROD_DATABASE_URL` set once — see Setup below.

```bash
bun run prod:rest <get|count|insert|update|delete|rpc> <table|fn> [flags]
bun run prod:sql  '<query>'  |  -f <file>  [--write] [--json] [--yes]
```

## Setup (one-time, SQL mode only)

REST mode works out of the box (it reads the self-host `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` from `.env.cloud`). SQL mode needs the self-host
pooler DSN in `.env.cloud.local` (gitignored):

```bash
# the value is the DATABASE_URL line printed by:
bun scripts/db/migrate/print-cutover-env.ts
# add it to .env.cloud.local as:
PROD_DATABASE_URL=postgresql://postgres.dev_tenant:<pw>@supabase.hearted.music:5432/postgres?sslmode=require
```

Note the pooler username is `postgres.dev_tenant` (supavisor's `<role>.<tenant>`
form) and `?sslmode=require` is required. Without `PROD_DATABASE_URL`, SQL mode
falls back to the **legacy hosted** pooler — which breaks once hosted is deleted.

## Which mode

| Mode | Transport | Use for | Credential | Safety |
| --- | --- | --- | --- | --- |
| `prod:rest` | PostgREST HTTP + service-role key | Whole-row CRUD on a single table, RPC calls | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (`.env.cloud`) | Can't run DDL/`DROP`; writes need confirmation; refuses unfiltered update/delete |
| `prod:sql` | Direct Postgres (postgres.js) | Joins, `group by`, aggregates, DDL, transactions, `COPY` | `PROD_DATABASE_URL` (`.env.cloud.local`) — self-host pooler | Read-only by default; `--write` + confirmation to mutate |

**Rule of thumb:** reach for `prod:rest` first — no DB password, and it
physically can't run a stray `DROP`. Drop to `prod:sql` only when REST can't
express the query (anything with a join, aggregate, DDL, or multi-statement
transaction).

> The Supabase CLI has **no** ad-hoc SQL command — only `db dump` (read) and
> `db push`/`migration up` (apply migration files). This tool fills that gap for
> one-off reads/writes. The CLI authenticates via a throwaway role through the
> Management API, which is why it never prompts for a password.

## REST mode

```bash
# reads — no confirmation, no password
bun run prod:rest get user --select id,name,email --order created_at
bun run prod:rest get account --eq handle=ghr --select id,email,handle
bun run prod:rest count liked_song --eq account_id=<uuid>
bun run prod:rest rpc some_function --data '{"arg":1}'

# writes — prompt to type the project ref unless --yes
bun run prod:rest insert user_preferences --data '{"account_id":"<uuid>"}'
bun run prod:rest update account --eq id=<uuid> --data '{"handle":"new"}'
bun run prod:rest delete account --eq id=<uuid>          # DB cascade does the rest
```

Flags: `--select`, `--order`, `--limit`, repeatable `--eq col=val`, raw
`--filter 'col=op.val'` (any PostgREST operator), `--data '<json>'`, `--json`,
`--yes`. `update`/`delete` refuse to run without a filter.

## SQL mode

```bash
# read-only by default — a stray write fails with "read-only transaction"
bun run prod:sql 'select count(*) from account'
bun run prod:sql 'select a.handle, count(*) from liked_song l join account a on a.id = l.account_id group by 1'
bun run prod:sql -f scripts/db/report.sql --json

# writes — opens a write transaction; prompts for the ref unless --yes
bun run prod:sql --write 'update account set handle = lower(handle)'

# point at LOCAL instead (for testing the tool itself)
bun run prod:sql --url postgresql://postgres:postgres@127.0.0.1:54322/postgres 'select 1'
```

Flags: `-f <file>`, `-` (stdin), `--write`, `--yes`, `--json`, `--url <dsn>`.

Read-only is enforced with an explicit `BEGIN; SET TRANSACTION READ ONLY; …`
wrapper — **not** the `default_transaction_read_only` startup option, which the
Supabase pooler silently drops. Don't reintroduce the startup-option approach.

## Deleting a user (worked example)

Deleting an account cascades automatically: **every `account_id` foreign key is
`ON DELETE CASCADE`**, so removing the `account` row clears liked_songs,
unlocks, billing, jobs, playlists, prefs, etc. On the Better Auth side,
`oauth_account` and `session` cascade from `user`. The only non-cascading edge is
`account.better_auth_user_id → user`, so **delete `account` before `user`**:

```bash
# 1. confirm scope first
bun run prod:rest count liked_song --eq account_id=<accountId>
# 2. delete (account cascade, then auth user)
bun run prod:rest delete account --eq id=<accountId>
bun run prod:rest delete user    --eq id=<betterAuthUserId>
# 3. verify
bun run prod:rest get user --select id,email
```

Resolve the ids first with `prod:rest get account --eq email=<email>` (gives
`id` and `better_auth_user_id`).

## Safety notes

- **Always confirm scope before a prod write/delete.** Count the affected rows
  first; for destructive ops, surface the blast radius and get explicit go.
- The typed-ref confirmation / `--yes` is a fat-finger guardrail, **not** a
  permission boundary — anyone running these scripts already holds prod creds.
- **The service-role key bypasses RLS.** Only ever from trusted local/server
  scripts like this — never client-side.
- REST creds come from `.env.cloud`, not the local `.env` (bun auto-loads `.env`
  with a `127.0.0.1` URL); the tool reads the cloud file first and aborts if it
  resolves a localhost URL.
- **The typed-ref string differs by mode** (it's derived from the connection):
  REST shows `ref=supabase` (from the `supabase.hearted.music` host), SQL shows
  `ref=dev_tenant` (the pooler tenant). The write prompt prints the exact `ref=`
  to type — just type what it shows.
- **GUI alternative:** Supabase Studio is live at `https://supabase.hearted.music`
  (HTTP basic-auth; user `SERVICE_USER_ADMIN` / pass `SERVICE_PASSWORD_ADMIN` via
  `coolify service env get fcuhypd724cwmn4dhx74qqja <key> -s`). Same elevated
  access — it also bypasses RLS.
- This project typechecks with `tsgo` (`bun run typecheck`). The editor's plain
  tsserver may false-flag `process`/`Bun` in this script — ignore it; tsgo is
  authoritative.
