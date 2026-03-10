## Context

Environment variables are currently managed via `@t3-oss/env-core` in `src/env.ts`, which validates with Zod and creates a typed `env` object. However, ~20 call sites in `src/lib/` access `process.env` directly, bypassing validation. Adding a new variable requires edits in three places: the Zod schema, the `runtimeEnv` mapping, and `.env.example`.

Varlock (`@dmno-dev/varlock`) replaces this with a single `.env.schema` file using `@env-spec` decorators, auto-generated TypeScript types, a Vite plugin for build-time optimization, and runtime security features. It ships a `@varlock/vite-integration` package designed for Vite-based frameworks.

The app deploys to Cloudflare Workers via TanStack Start. The Vite plugin's `ssrInjectMode` setting must account for Workers' lack of native `process.env`.

## Goals / Non-Goals

**Goals:**
- Single source of truth for env var schema (`.env.schema` file with decorators)
- Type-safe `ENV` object used consistently across all server-side code
- Auto-generated `env.d.ts` — no manual type maintenance
- Leak scanning via `varlock scan` in CI and as pre-commit hook
- Clean migration path — no behavior changes, just infrastructure swap

**Non-Goals:**
- Secret manager plugins (1Password, etc.) — future work, not needed now
- Log redaction / `patchGlobalConsole` — evaluate after initial migration
- Migrating Vite built-ins (`import.meta.env.DEV`, `import.meta.env.VITE_DEVTOOLS`) — these are framework-level, not app env vars
- Changing any env var names or values

## Decisions

### 1. Schema file location: `.env.schema` at project root

**Choice**: Use varlock's default `.env.schema` at project root.
**Rationale**: Convention over configuration. `varlock init` expects this. The schema replaces both the Zod definitions in `src/env.ts` and the documentation role of `.env.example`.
**Alternative**: Custom path — adds config overhead with no benefit.

### 2. Vite plugin SSR inject mode: `resolved-env`

**Choice**: Use `ssrInjectMode: 'resolved-env'` in the Vite plugin config.
**Rationale**: Cloudflare Workers doesn't have `process.env`. The `resolved-env` mode injects fully resolved values at build time, which is what the current t3-env setup effectively does via the `serverEnv` workaround. This is also the mode varlock recommends for Workers.
**Alternative**: `auto-load` mode — requires Node.js `execSync` at startup, not available in Workers.

### 3. Import pattern: `import { ENV } from 'varlock/env'`

**Choice**: All env access goes through `ENV.<VAR_NAME>`.
**Rationale**: Varlock's `ENV` object is type-safe (generated from schema), validated at load time, and supports leak detection. Direct `process.env` access loses all of these.
**Alternative**: Keep `process.env` in tests — acceptable since test env is controlled, but prefer `ENV` for consistency. Test files that manipulate `process.env` for mocking will need adjustment (use `vi.stubEnv` or varlock's test utilities).

### 4. Keep `.env.example` alongside `.env.schema`

**Choice**: Keep `.env.example` as a quick-start file but mark it as secondary to `.env.schema`.
**Rationale**: `.env.example` is a well-known convention for cloning repos. `.env.schema` is self-documenting but the format is less familiar. Keep both during transition; `.env.example` can be auto-generated from schema later.
**Alternative**: Delete `.env.example` — too aggressive for a first migration.

### 5. Delete `src/env.ts` entirely

**Choice**: Remove `src/env.ts` and all imports of it. Replace with direct `import { ENV } from 'varlock/env'` at each call site.
**Rationale**: `src/env.ts` was the centralized validation+access layer. Varlock subsumes this role entirely — the schema file handles validation, the generated types handle safety, and the `ENV` object handles access. A wrapper would add indirection with no value.
**Alternative**: Thin re-export wrapper — violates "no barrel exports" project rule and adds unnecessary indirection.

### 6. Vite config integration point: `app.config.ts`

**Choice**: Add `varlockVitePlugin()` in `app.config.ts` under TanStack Start's Vite config.
**Rationale**: TanStack Start uses `app.config.ts` which wraps Vite config. The plugin should be added there, not in a separate `vite.config.ts`.

## Risks / Trade-offs

- **[Cloudflare Workers compatibility]** → Mitigation: Use `ssrInjectMode: 'resolved-env'`. Test deployed build early in migration. If issues arise, varlock's Vite plugin handles Workers as a documented use case.

- **[Test mocking complexity]** → Mitigation: Tests that directly set `process.env.VAR = "value"` will need to use `vi.stubEnv()` or varlock's test utilities. Audit all test files touching env vars. This is ~5 test files.

- **[Varlock maturity (v0.4.0)]** → Mitigation: Varlock is from the DMNO team (established in config tooling). The core is the `@env-spec` standard which is stable. Pin the version. The migration is reversible — re-adding t3-env is straightforward if needed.

- **[Build-time resolution means env changes need rebuild]** → This is the same behavior as the current t3-env + Vite setup. No regression.

## Migration Plan

1. Install `varlock` and `@varlock/vite-integration`
2. Create `.env.schema` with all current variables and decorators
3. Run `varlock typegen` to generate `env.d.ts`
4. Add `varlockVitePlugin({ ssrInjectMode: 'resolved-env' })` to `app.config.ts`
5. Delete `src/env.ts`, update all imports from `@/env` to `import { ENV } from 'varlock/env'`
6. Migrate all direct `process.env.*` access in `src/lib/` to `ENV.*`
7. Update test files that mock env vars
8. Remove `@t3-oss/env-core` dependency
9. Add `varlock scan --staged` as pre-commit hook
10. Verify local dev, build, and deployed Workers all pass

**Rollback**: Revert to the commit before migration. Re-install `@t3-oss/env-core`. No data migration involved.

## Open Questions

- Should `env.d.ts` be committed or `.gitignore`d and generated in CI? (Leaning: commit it for IDE support, regenerate in CI to verify)
- Does varlock's Vite plugin work with TanStack Start's `createFileRoute` server functions out of the box, or does the SSR boundary need special handling?
