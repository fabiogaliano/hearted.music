## Why

The two hardening changes split job orchestration into clearer platform modules, but `src/lib/data` still mixes several unrelated concepts:

- DB infrastructure (`client.ts`, `database.types.ts`);
- platform persistence helpers (`api-tokens.ts`, `job-measurements.ts`, `job-failures.ts`);
- taste-domain queries (`match-decision-queries.ts`);
- static app content (`legal.ts`, `landing-songs*.ts`, `demo-matches.ts`).

That makes `data` ambiguous: sometimes it means Supabase infrastructure, sometimes table repositories, and sometimes static JSON-backed content. The existing `lib-module-topology` spec already says legacy implementation buckets such as `src/lib/data` should not be used for new feature modules, but the repo still needs a small, explicit exception for DB infrastructure.

This change normalizes those boundaries so future work has a single rule: persistence/query modules live with the domain or platform capability that owns the concept; `src/lib/data` only provides database infrastructure.

## What Changes

- Define `src/lib/data` as infrastructure-only:
  - keep `src/lib/data/client.ts`;
  - keep `src/lib/data/database.types.ts`;
  - move all feature/platform/content modules out.
- Move extension API token persistence to `src/lib/platform/auth/api-tokens.ts` and rename its public functions to extension-auth language.
- Move job execution measurement and job item failure helpers to `src/lib/platform/jobs/*` with job-specific names.
- Move match decision query operations to `src/lib/domains/taste/song-matching/decision-queries.ts` and rename insert helpers to upsert helpers.
- Move static legal, landing-song, and demo-match modules to `src/lib/content/*`.
- Add an architecture document such as `docs/architecture/module-boundaries.md` so the ownership rules remain discoverable after this OpenSpec change is archived.
- Update imports directly; do not add barrel exports or compatibility wrapper modules.

## Capabilities

### Modified Capabilities

- `lib-module-topology`: clarifies `src/lib/data`, adds `src/lib/content`, and records ownership rules for domain/platform persistence modules.

## Affected specs

- `openspec/specs/lib-module-topology/spec.md`

## Impact

- **Runtime behavior:** No intended behavior change. This is a module-boundary and naming cleanup.
- **Data/schema:** No database schema changes.
- **Files likely touched:**
  - `src/lib/data/api-tokens.ts`
  - `src/lib/data/job-measurements.ts`
  - `src/lib/data/job-failures.ts`
  - `src/lib/data/match-decision-queries.ts`
  - `src/lib/data/match-decision-queries.test.ts`
  - `src/lib/data/legal.ts`
  - `src/lib/data/landing-songs.ts`
  - `src/lib/data/landing-songs.server.ts`
  - `src/lib/data/demo-matches.ts`
  - `src/lib/platform/auth/api-tokens.ts`
  - `src/lib/platform/jobs/execution-measurements.ts`
  - `src/lib/platform/jobs/item-failures.ts`
  - `src/lib/domains/taste/song-matching/decision-queries.ts`
  - `src/lib/content/**`
  - affected imports under `src/routes`, `src/features`, `src/lib/server`, `src/lib/workflows`, and tests.
- **Verification:** focused tests for affected modules, `bun run typecheck`, and grep gates proving no feature imports remain from `@/lib/data/*`.
