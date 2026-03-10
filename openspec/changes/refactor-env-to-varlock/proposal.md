## Why

Environment variable management uses `@t3-oss/env-core` + Zod in `src/env.ts`, but ~20 call sites bypass the typed `env` object and access `process.env` directly — losing validation, type safety, and discoverability. Every new variable must be declared in three places (Zod schema, `runtimeEnv` mapping, `.env.example`). There is no leak protection, log redaction, or secret scanning. Varlock (`@dmno-dev/varlock`) consolidates all of this into a single `.env.schema` file with decorators, auto-generates TypeScript types, provides a Vite plugin, and adds runtime security features (leak scanning, log redaction).

## What Changes

- **BREAKING** — Remove `@t3-oss/env-core` and `zod` (as env dependency; Zod is still used elsewhere) in favor of `varlock` + `@varlock/vite-integration`
- Replace `src/env.ts` (t3-env createEnv) with `import { ENV } from 'varlock/env'` usage
- Create `.env.schema` with `@env-spec` decorators defining all current variables, their types, sensitivity, and requirements
- Add `varlockVitePlugin()` to `app.config.ts` Vite config
- Migrate all direct `process.env.*` access in `src/lib/` to use the typed `ENV` object
- Keep `import.meta.env.DEV` / `import.meta.env.VITE_DEVTOOLS` (Vite built-ins, not env vars we own)
- Add `varlock scan` as a pre-commit hook for secret leak prevention
- Auto-generate `env.d.ts` via `@generateTypes` decorator
- Update `.env.example` to align with new schema format or remove in favor of `.env.schema` self-documenting

## Capabilities

### New Capabilities
- `env-management`: Centralized environment variable schema, validation, type generation, and runtime access via varlock

### Modified Capabilities
<!-- None — existing specs define behavioral contracts without specifying env var access patterns. The migration is purely infrastructural. -->

## Impact

- **Dependencies**: Add `varlock`, `@varlock/vite-integration`. Remove `@t3-oss/env-core` (Zod stays for non-env validation).
- **Files**: `src/env.ts` replaced, `app.config.ts` updated, ~15 files in `src/lib/` updated to use `ENV` import, new `.env.schema` created, `env.d.ts` auto-generated
- **CI/CD**: Add `varlock scan` step; `varlock typegen` in dev workflow
- **Cloudflare Workers**: May need `ssrInjectMode: 'resolved-env'` in Vite plugin config for Workers runtime compatibility
