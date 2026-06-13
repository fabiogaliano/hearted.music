# scripts/db

Tooling for talking to the database directly.

## `prod.ts` — production reads/writes

```bash
bun run prod:rest get user --select id,name,email   # PostgREST + service-role (no password)
bun run prod:sql  'select count(*) from account'     # direct Postgres (read-only by default)
```

Two modes: `prod:rest` (row-level CRUD/RPC, no DB password) and `prod:sql`
(arbitrary SQL, read-only unless `--write`). Credentials are already in
`.env.cloud` / `.env`.

**Full guide + safety model:** the `supabase-prod` skill
(`.claude/skills/supabase-prod/SKILL.md`) — or just ask Claude "how do I query prod".

For the **local** database, use the `supabase-local` skill instead.
