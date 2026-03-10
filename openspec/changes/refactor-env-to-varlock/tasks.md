## 1. Dependencies & Tooling

- [ ] 1.1 Install `varlock` and `@varlock/vite-integration` via `bun add -d varlock @varlock/vite-integration`
- [ ] 1.2 Remove `@t3-oss/env-core` via `bun remove @t3-oss/env-core`

## 2. Schema & Type Generation

- [ ] 2.1 Create `.env.schema` at project root with all env vars from current `src/env.ts`, using `@env-spec` decorators (`@type`, `@sensitive`, `@required`). Include `@generateTypes(lang="ts", path="env.d.ts")` and `@defaultRequired=infer` document decorators
- [ ] 2.2 Run `varlock typegen` to generate `env.d.ts` at project root
- [ ] 2.3 Add `env.d.ts` to `tsconfig.json` includes (if not auto-discovered) and to `.gitignore` with a comment noting it's auto-generated (or commit it — see open question in design)

## 3. Vite Plugin Integration

- [ ] 3.1 Add `varlockVitePlugin({ ssrInjectMode: 'resolved-env' })` to `app.config.ts` Vite plugins array. Import from `@varlock/vite-integration`

## 4. Migrate Core Env Access

- [ ] 4.1 Delete `src/env.ts`
- [ ] 4.2 Update `src/lib/auth.ts` — replace `import { env } from "@/env"` with `import { ENV } from "varlock/env"`, update all `env.VAR` → `ENV.VAR`
- [ ] 4.3 Update `src/routes/index.tsx` — same import migration
- [ ] 4.4 Update `src/features/landing/components/WaitlistInput.tsx` — same import migration (if it uses env)
- [ ] 4.5 Update `src/lib/server/waitlist.functions.ts` — same import migration (if it uses env)

## 5. Migrate Direct process.env Access in src/lib/

- [ ] 5.1 `src/lib/integrations/spotify/request.ts` — replace `process.env.DEBUG_SPOTIFY_ERRORS` with `ENV.DEBUG_SPOTIFY_ERRORS` (add to schema if not present, or keep as `process.env` if it's a debug-only flag not worth schematizing)
- [ ] 5.2 `src/lib/integrations/deepinfra/service.ts` — replace `process.env.DEEPINFRA_API_KEY` with `ENV.DEEPINFRA_API_KEY`
- [ ] 5.3 `src/lib/ml/adapters/deepinfra.ts` — replace `process.env.DEEPINFRA_API_KEY` with `ENV.DEEPINFRA_API_KEY`
- [ ] 5.4 `src/lib/ml/adapters/local.ts` — replace `process.env.ML_PROVIDER` with `ENV.ML_PROVIDER`
- [ ] 5.5 `src/lib/ml/llm/service.ts` — replace `process.env.GEMINI_API_KEY`, `process.env.ANTHROPIC_API_KEY`, `process.env.OPENAI_API_KEY` with `ENV.*` (add to schema if not present)
- [ ] 5.6 `src/lib/capabilities/analysis/pipeline.ts` — replace `process.env.GOOGLE_GENERATIVE_AI_API_KEY`, `process.env.GOOGLE_API_KEY`, `process.env.ANTHROPIC_API_KEY`, `process.env.OPENAI_API_KEY`, `process.env.GENIUS_CLIENT_TOKEN` with `ENV.*`
- [ ] 5.7 `src/lib/capabilities/lyrics/service.ts` — replace `process.env.DEBUG_LYRICS_SEARCH` and `process.env.GENIUS_CLIENT_TOKEN` with `ENV.*`

## 6. Update Schema for Newly Discovered Vars

- [ ] 6.1 Add env vars found in step 5 that weren't in the original `src/env.ts` schema to `.env.schema`: `DEBUG_SPOTIFY_ERRORS`, `DEBUG_LYRICS_SEARCH`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY`. Mark debug flags as `@type=boolean` optional, API keys as `@sensitive` optional
- [ ] 6.2 Re-run `varlock typegen` to update `env.d.ts` with the new vars

## 7. Update Tests

- [ ] 7.1 `src/lib/capabilities/analysis/__tests__/pipeline-lyrics.test.ts` — replace direct `process.env` assignment with `vi.stubEnv()` calls
- [ ] 7.2 `src/lib/capabilities/analysis/__tests__/analysis-pipeline-full-flow.integration.test.ts` — replace `process.env.*` reads with `ENV.*` or `vi.stubEnv()`
- [ ] 7.3 `src/lib/capabilities/profiling/__tests__/playlist-profiling-integration.test.ts` — replace `process.env.PROFILING_TEST` with `ENV` or `vi.stubEnv()`
- [ ] 7.4 `src/lib/capabilities/lyrics/__tests__/lyrics-service.integration.test.ts` — replace `process.env.GENIUS_CLIENT_TOKEN` with `ENV` or `vi.stubEnv()`
- [ ] 7.5 `src/lib/capabilities/lyrics/__tests__/generate-snapshots.ts` — replace `process.env.GENIUS_CLIENT_TOKEN` with `ENV`

## 8. Leak Scanning Setup

- [ ] 8.1 Add `varlock scan --staged` as a pre-commit hook (via `.husky/pre-commit`, `lint-staged`, or `lefthook` — match existing project hook setup)
- [ ] 8.2 Add `"scan": "varlock scan"` and `"typegen": "varlock typegen"` scripts to `package.json`

## 9. Cleanup & Verification

- [ ] 9.1 Remove or update `.env.example` — either regenerate from schema or add a comment pointing to `.env.schema` as the source of truth
- [ ] 9.2 Grep entire `src/` for remaining `process.env` references (excluding `import.meta.env.DEV` and test `vi.stubEnv`). Fix any stragglers
- [ ] 9.3 Grep for `@/env` or `from "@/env"` imports — ensure zero matches
- [ ] 9.4 Run `bun run build` and verify no build errors
- [ ] 9.5 Run `bun run dev` and verify env validation passes
- [ ] 9.6 Run `bun run test` and verify all tests pass
- [ ] 9.7 Run `varlock scan` and verify clean output
