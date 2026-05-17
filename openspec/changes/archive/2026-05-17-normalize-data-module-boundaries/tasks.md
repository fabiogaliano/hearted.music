## 1. Establish Boundary Documentation

- [x] 1.1 Add `docs/architecture/module-boundaries.md` describing ownership rules for `src/lib/data`, `src/lib/domains`, `src/lib/platform`, `src/lib/workflows`, `src/lib/integrations`, `src/lib/shared`, and `src/lib/content`.
- [x] 1.2 Document that `src/lib/data` is limited to DB infrastructure (`client.ts`, `database.types.ts`, and future low-level DB adapter setup only).
- [x] 1.3 Document that persistence/query modules live with the owning domain or platform capability, not in `src/lib/data`.
- [x] 1.4 Document that static JSON/content-backed helpers live under `src/lib/content/**`.

## 2. Move Extension API Token Persistence

- [x] 2.1 Move `src/lib/data/api-tokens.ts` to `src/lib/platform/auth/api-tokens.ts`.
- [x] 2.2 Rename exports: `generateApiToken` -> `createExtensionApiToken`, `validateApiToken` -> `validateExtensionApiToken`, `revokeAllTokensForAccount` -> `revokeExtensionApiTokensForAccount`.
- [x] 2.3 Update extension route imports and mocks under `src/routes/api/extension/**`.
- [x] 2.4 Ensure no compatibility wrapper remains at `src/lib/data/api-tokens.ts`.

## 3. Move Job Measurement and Item-Failure Helpers

- [x] 3.1 Move `src/lib/data/job-measurements.ts` to `src/lib/platform/jobs/execution-measurements.ts`.
- [x] 3.2 Rename exports: `recordExecutionMeasurement` -> `recordJobExecutionMeasurement`, `getLatestExecutionMeasurementForJob` -> `getLatestJobExecutionMeasurement`.
- [x] 3.3 Update library-processing runner, terminal recovery, and tests to import the new module and names.
- [x] 3.4 Move `src/lib/data/job-failures.ts` to `src/lib/platform/jobs/item-failures.ts`.
- [x] 3.5 Rename exports: `recordJobFailure` -> `recordJobItemFailure`, `resolveStageFailures` -> `resolveJobStageFailures`, `countUnresolvedFailures` -> `countUnresolvedJobStageFailures`.
- [x] 3.6 Update enrichment-pipeline failure recording, stage-outcome code, and tests to import the new module and names.
- [x] 3.7 Ensure no compatibility wrappers remain at `src/lib/data/job-measurements.ts` or `src/lib/data/job-failures.ts`.

## 4. Move Match Decision Queries to Taste Domain

- [x] 4.1 Move `src/lib/data/match-decision-queries.ts` to `src/lib/domains/taste/song-matching/decision-queries.ts`.
- [x] 4.2 Move `src/lib/data/match-decision-queries.test.ts` to the matching domain test location, e.g. `src/lib/domains/taste/song-matching/__tests__/decision-queries.test.ts`.
- [x] 4.3 Rename exports: `insertMatchDecision` -> `upsertMatchDecision`, `insertMatchDecisions` -> `upsertMatchDecisions`.
- [x] 4.4 Keep `getMatchDecisions`, `getMatchDecisionsForSongs`, and `MatchDecision` names unless implementation reveals a stronger domain name.
- [x] 4.5 Update matching server imports and mocks under `src/lib/server/**`.
- [x] 4.6 Ensure no compatibility wrapper remains at `src/lib/data/match-decision-queries.ts`.

## 5. Move Static Content Modules

- [x] 5.1 Create `src/lib/content/landing/`.
- [x] 5.2 Move `src/lib/data/demo-matches.ts` to `src/lib/content/landing/demo-matches.ts`.
- [x] 5.3 Move `src/lib/data/landing-songs.ts` to `src/lib/content/landing/landing-songs.ts`.
- [x] 5.4 Move `src/lib/data/landing-songs.server.ts` to `src/lib/content/landing/landing-songs.server.ts` and update its relative type import.
- [x] 5.5 Move `src/lib/data/legal.ts` to `src/lib/content/legal.ts`.
- [x] 5.6 Update imports and mocks under `src/routes`, `src/features`, and `src/lib/server`.
- [x] 5.7 Ensure no compatibility wrappers remain under `src/lib/data` for moved content modules.

## 6. Remove Empty Legacy Data Modules and Verify Imports

- [x] 6.1 Delete all moved files from `src/lib/data`, leaving only `client.ts` and `database.types.ts`.
- [x] 6.2 Run `rg "@/lib/data/" src` and verify remaining imports are only `@/lib/data/client` and `@/lib/data/database.types`.
- [x] 6.3 Run `rg "from .*data/" src` and verify remaining imports are only the same allowed DB infrastructure modules.
- [x] 6.4 Run rename greps and verify no stale references remain: `rg "insertMatchDecision|insertMatchDecisions|generateApiToken|validateApiToken|recordExecutionMeasurement|recordJobFailure|resolveStageFailures|countUnresolvedFailures" src`.
- [x] 6.5 Do not add barrel exports or old-path re-export wrappers.

## 7. Validation

- [x] 7.1 Run focused affected tests: `bun run test src/lib/domains/taste/song-matching src/lib/workflows/enrichment-pipeline src/lib/workflows/library-processing src/routes/api/extension src/lib/server`.
- [x] 7.2 Run `bun run typecheck`.
- [x] 7.3 Run `openspec validate normalize-data-module-boundaries --strict --no-interactive`.
- [x] 7.4 If focused tests expose pre-existing unrelated failures, document the exact suite/test and keep the task unchecked unless the focused migration behavior was still verified through a narrower passing command.
