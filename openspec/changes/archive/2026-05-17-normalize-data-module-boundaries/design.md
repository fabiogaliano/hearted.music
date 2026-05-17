## Context

`src/lib/data` currently contains both low-level database infrastructure and modules that have clearer owners elsewhere:

| Current module | Current role | Target owner |
| --- | --- | --- |
| `src/lib/data/client.ts` | Supabase client setup | keep in `src/lib/data` |
| `src/lib/data/database.types.ts` | generated Supabase DB types | keep in `src/lib/data` |
| `src/lib/data/api-tokens.ts` | extension bearer-token persistence | `src/lib/platform/auth/api-tokens.ts` |
| `src/lib/data/job-measurements.ts` | job execution measurement persistence | `src/lib/platform/jobs/execution-measurements.ts` |
| `src/lib/data/job-failures.ts` | per-item job failure persistence | `src/lib/platform/jobs/item-failures.ts` |
| `src/lib/data/match-decision-queries.ts` | taste/matching decision queries | `src/lib/domains/taste/song-matching/decision-queries.ts` |
| `src/lib/data/legal.ts` | static legal content | `src/lib/content/legal.ts` |
| `src/lib/data/landing-songs.ts` | landing-song content models/helpers | `src/lib/content/landing/landing-songs.ts` |
| `src/lib/data/landing-songs.server.ts` | bundled landing-song content loader | `src/lib/content/landing/landing-songs.server.ts` |
| `src/lib/data/demo-matches.ts` | static demo match content | `src/lib/content/landing/demo-matches.ts` |

The existing `lib-module-topology` spec defines domain, workflow, integration, platform, and shared ownership. This change extends that topology with `src/lib/content` and makes `src/lib/data` an explicit infrastructure exception rather than a general module bucket.

## Goals / Non-Goals

**Goals:**

- Make `src/lib/data` mean database infrastructure only.
- Move remaining feature/platform/content modules to their semantic owners.
- Use clearer public names where the old names reflected table operations rather than domain/platform intent.
- Avoid compatibility wrappers and barrel exports.
- Capture the boundary rule in both OpenSpec and a repo architecture document.

**Non-Goals:**

- Changing database schema, row shapes, RPC names, or Supabase client behavior.
- Refactoring the internals of query functions beyond import paths and agreed renames.
- Moving domain query modules that are already under `src/lib/domains/*`.
- Moving `src/lib/data/client.ts` or `src/lib/data/database.types.ts`.

## Decisions

### 1. `src/lib/data` is database infrastructure only

**Decision:** Keep only database infrastructure under `src/lib/data`: Supabase client setup, generated database types, and future low-level database adapter setup if needed.

**Rule:** A module that exports business/platform operations, query functions, or static app content must not live under `src/lib/data` even if it uses Supabase internally.

**Rationale:** Most domain query modules already live near their bounded context. Keeping `data` as infrastructure-only prevents another broad `data/jobs.ts`-style module from forming.

### 2. Persistence modules live with their owning concept

**Decision:** Place DB access according to conceptual ownership:

- domain-owned persistence under `src/lib/domains/<domain>/**`;
- cross-cutting platform persistence under `src/lib/platform/<capability>/**`;
- workflow orchestration under `src/lib/workflows/**` only when it coordinates steps rather than owning table access;
- static JSON/content-backed modules under `src/lib/content/**`.

**Rationale:** Callers should import the capability they need, not the storage implementation bucket. This makes module names communicate business/platform intent.

### 3. Rename functions where names are table-shaped or ambiguous

**Decision:** Apply the following public renames during the move:

| Current export | New export |
| --- | --- |
| `generateApiToken` | `createExtensionApiToken` |
| `validateApiToken` | `validateExtensionApiToken` |
| `revokeAllTokensForAccount` | `revokeExtensionApiTokensForAccount` |
| `recordExecutionMeasurement` | `recordJobExecutionMeasurement` |
| `getLatestExecutionMeasurementForJob` | `getLatestJobExecutionMeasurement` |
| `recordJobFailure` | `recordJobItemFailure` |
| `resolveStageFailures` | `resolveJobStageFailures` |
| `countUnresolvedFailures` | `countUnresolvedJobStageFailures` |
| `insertMatchDecision` | `upsertMatchDecision` |
| `insertMatchDecisions` | `upsertMatchDecisions` |

Keep type names when they already describe the domain clearly, such as `JobExecutionMeasurement` and `MatchDecision`.

**Rationale:** The new module paths provide ownership; the renamed functions clarify behavior. For example, match-decision writes use Supabase `upsert`, so `upsertMatchDecision` is more accurate than `insertMatchDecision`.

### 4. No wrappers or barrel exports

**Decision:** Update every consumer to import directly from the new owning module. Do not leave `src/lib/data/*` wrappers that re-export moved functions. Do not add `index.ts` barrels.

**Rationale:** Wrappers preserve the ambiguous boundary and make grep-based verification weaker. Direct imports keep ownership explicit.

### 5. Static content gets a first-class `src/lib/content` home

**Decision:** Add `src/lib/content` for static app content and content-backed helpers, including legal documents, landing-song manifests/details, and demo match data.

**Rationale:** These modules are not DB data and not domain persistence. A content boundary makes their purpose clear without forcing them into `features` or `domains`.

## Migration Plan

1. Move auth token persistence to `src/lib/platform/auth/api-tokens.ts`, rename exports, and update extension route imports/tests.
2. Move job measurement/failure helpers to `src/lib/platform/jobs/*`, rename exports, and update runner/recovery/enrichment-pipeline imports/tests.
3. Move match-decision queries and tests to `src/lib/domains/taste/song-matching/decision-queries.ts`, rename upsert exports, and update matching server imports/tests.
4. Move static content modules to `src/lib/content/*`, update route/feature/server imports/tests, and keep relative imports inside the moved content modules direct.
5. Add `docs/architecture/module-boundaries.md` documenting the ownership rules and examples.
6. Verify no imports remain from `@/lib/data/*` except `@/lib/data/client` and `@/lib/data/database.types`.

## Risks / Trade-offs

- **[Import churn]** This touches many files but should be mechanical. Mitigation: migrate by area and run focused tests after each area if needed.
- **[Missed mocks]** Vitest mocks use exact module paths. Mitigation: grep for old paths and update tests with the same rename map.
- **[Name churn]** Renames improve clarity but expand the diff. Mitigation: keep behavior unchanged and avoid unrelated refactors.
- **[Topology spec change]** The existing spec called `src/lib/data` legacy. Mitigation: modify the spec to allow only the explicit infrastructure exception.

## Verification Strategy

- `rg "@/lib/data/" src` must show only `@/lib/data/client` and `@/lib/data/database.types`.
- `rg "from .*data/" src` must show only the same allowed infrastructure imports.
- `rg "insertMatchDecision|insertMatchDecisions|generateApiToken|validateApiToken|recordExecutionMeasurement|recordJobFailure|resolveStageFailures|countUnresolvedFailures" src` must show no stale production imports after renames.
- Run focused affected tests, at minimum:
  - `bun run test src/lib/domains/taste/song-matching src/lib/workflows/enrichment-pipeline src/lib/workflows/library-processing src/routes/api/extension src/lib/server`
- Run `bun run typecheck`.
- Run `openspec validate normalize-data-module-boundaries --strict --no-interactive`.

## Open Questions

- Should static content later move closer to route/features if `src/lib/content` grows too large? For this change, keep a single content boundary and split only if real subdomains emerge.
