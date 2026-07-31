
# hearted.

Single package, not a monorepo — `extensions/` (WebExtension), `control-panel/` (admin), and `src/worker/` (Bun worker) are sub-apps with their own package.json/tsconfig.

Facts you will otherwise guess wrong:

- No ORM. `drizzle-orm` serves only the Better Auth adapter (`src/lib/platform/auth/`) — never use it for queries. DB access is Supabase JS + raw `postgres`.
- Tailwind 4, React 19, Zod 4 — no v3/v18-era syntax.
- All fallible code returns `better-result` (`Result`/`TaggedError`); see Conventions.

Work on `main` unless told otherwise.

## Commands

- Usually I'll have it already running but - Dev: `bun run dev` · full stack: `bun run dev:all` (app + worker + embeddings)
- Typecheck: `bun run typecheck` (tsgo; worker: `typecheck:worker`)
- Lint/format: `bun run check` (Biome; lefthook auto-fixes staged files on commit)
- Test one file: `bun run test src/path/__tests__/x.test.tsx` — verify with the file, not the full suite
- After adding a migration: `bunx supabase db push` (local), then `bun run gen:types`

## Safety boundaries

- Prod deploys/migrations are CI-only (merge to `main`): never `bun run deploy`, `bun run deploy:secrets`, or `supabase db push --linked`. Schema changes: timestamped file in `supabase/migrations/`, per `docs/ops/prod-db-migrations.md` (expand–contract; destructive DDL manual-only).
- Prod data only via the `supabase-prod` skill: `bun run prod:rest`, or `bun run prod:sql` when REST can't express it. Never point local tooling at prod URLs.
- `scripts/ops/*` mutate real account state — run only on explicit request.

## Conventions

- Before adding queries or persistence code, read `docs/architecture/module-boundaries.md` — the source of truth for where code lives.
- Server functions: `src/lib/server/*.functions.ts`, `createServerFn().inputValidator(zod).handler()`. Domain code returns `Result`, never throws; only the server-fn boundary throws (`new Error(msg, { cause })` + `captureServerError`). Pattern: `public-handle.functions.ts`.
- No barrel exports — import by direct path.
- DB-derived id sets never re-enter a query as `.in()` URL filters — push the predicate into an RPC/join. `chunkedRead` is only for externally-sourced id lists.

## Design principles

- Deletion test for helpers/wrappers: if deleting it makes the complexity vanish, it's a pass-through — inline it. A kept module's interface must be simpler than its implementation.
- Structure is earned by present need, never anticipated: no abstraction before the third occurrence, no interface with one implementation, no option/callback no caller uses. If an abstraction needs a new boolean/variant param for a new caller, inline it back to duplication.
- Don't split modules by execution order (parse → transform → save, one file per step) — group by shared knowledge instead.
- Mutually exclusive states are one discriminated union, never co-occurring booleans (`isLoading`/`isError`/`hasData`).
- Parse once at the boundary (Zod at the server-fn/route edge) — never re-check a field's shape downstream.
- Before adding a `try/catch` or error branch, define the error out of existence (return `[]` not `null`; make "unset" valid).
- Pure domain logic (pricing, filtering, state transitions) imports no IO — no supabase client, `fetch`, or storage. IO lives in server fns, loaders, and the worker.
- Re-invocable handlers (job claims, SSE reconnects, webhooks) must be idempotent: conflict-safe writes or a dedupe key.
- A status column has one writer, and every transition is compare-and-set: `UPDATE … WHERE id = … AND status = 'expected-prior'` (+ `locked_by` for claimed jobs).
- A fact computable from stored data gets one pure derive function, never a new column — consumers call it instead of re-deriving.
- The diff stays inside the task: name unrelated bugs in your reply, don't fix them. Structural (rename/extract/move) and behavior changes go in separate commits.

## Glossary

- **account** = domain identity (`account` table). **user** = Better Auth identity only. Don't conflate.
- **enrichment** = pipeline making a liked song matchable (audio features → analysis → embedding → activation). **matching** = downstream scoring of candidates against playlists — never inside enrichment.
- **library-processing** = reconciler deciding what enrichment/match work to schedule after any library change.
- **job** = durable async unit (`job` table) claimed by the Bun worker.
- **unlock / entitlement** = billing gate on match-result visibility.

## Testing

Few tests, each load-bearing: a test earns its place only if you can name the plausible bug it catches — which already rules out trivial mappers, pass-throughs, static copy, and framework/type-system guarantees.

- Test in order of value: money/entitlements, job/state-machine transitions, data integrity, multi-step flows; pure logic only where behavior isn't obvious from one read.
- One flow test beats N unit tests re-verifying what the flow composes.
- Assert behavior, never copy — a copy edit must never break a test. `getByRole` + regex names; `getByTestId` only to surface hook state in a harness.
- Expected values come from the spec or hand calculation, never from running the code under test.
- Never delete or weaken a test to get green — fix the code, or report exactly which behavior changed. Regression pins stay however trivial they look; name the bug in the title when adding one.
- Flaky = a bug in the test: fix determinism (fake timers, seeded data, no network), never retry-wrap or skip.
- `render`/`screen` from `@/test/utils/render` (providers + `user`); `framer-motion`/`sonner` mocked globally; assert `Result`s with `toBeOk`/`toBeErr`/`toHaveOkValue`/`toHaveErrValue`. Mocking `react`/`@tanstack/*` is over-mocking.
- `.test.ts` = node, `.test.tsx` = jsdom (DOM-needing `.test.ts` → `domTestFiles` in `vite.config.ts`). `*.integration.test.ts` = real local Postgres (self-skips otherwise) — only for tests that need the DB.
- Fixtures: extend `src/test/fixtures.ts`, no ad hoc ones.
- Copy the exemplars: `MatchModeToggle.test.tsx` (component), `dashboard.functions.billing.test.ts` (server fn), `backfill-lifecycle.integration.test.ts` (DB state machine).

## Docs & specs

- Architecture: `docs/architecture/` (start with `system-overview.md`). Ops runbooks: `docs/ops/`.
- Nontrivial feature work goes through `openspec/` (use the `/opsx:*` skills).

## Required Skills

Use these skills proactively when working on this project:

- **`tanstack-start-react`** - Routes, loaders, server functions, SSE
- **`react-best-practices`** - Component patterns, performance

## Agent defaults (vendored for cloud/remote sessions)

These mirror the maintainer's global `~/.claude/CLAUDE.md`, committed here so cloud
sessions (which clone only the repo, not `~/.claude`) follow the same rules.

- Use bun for everything; run tests with `bun run test` (Vitest). Never npm.
- Comments explain WHY only, written for the code's future reader — never restate the code or narrate the change.
- Build only what's asked. No speculative features.
- Never disable/skip tests. Find root cause, fix the issue.
- Tests → `tests/` or `__tests__/`. Scripts → `scripts/`. Analysis notes → `docs/tmp/`. Never create `claudedocs/`.
- Read files before Write/Edit. Absolute paths only. Parallel tool calls by default.
- Check `<env>` for current date before any temporal assessment.
