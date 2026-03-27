## Why

Library-processing follow-on scheduling is currently split across onboarding saves, extension sync, enrichment trigger helpers, worker chunk chaining, and refresh rerun mechanics. That split makes freshness semantics hard to trust, keeps queue-priority and measurement work blocked behind unclear ownership, and leaves `src/lib/workflows/enrichment-pipeline/batch.ts` with a scalability/correctness bug from giant app-side exclusion lists.

## What Changes

- Introduce a new `library-processing` control plane centered on `library_processing_state`, `applyLibraryProcessingChange(...)`, `reconcileLibraryProcessing(...)`, typed source changes, and effect-driven job ensuring.
- **BREAKING** hard-cut orchestration for both modeled workflows together: `enrichment` and `matchSnapshotRefresh` move to the new control plane with no legacy compatibility layer.
- Add schema foundations for the cutover: `library_processing_state`, a generic nullable job request-marker column, numeric `queue_priority`, durable `match_snapshot_refresh` naming/helpers, and DB-side selectors/RPCs for enrichment candidate selection.
- Replace policy-shaped trigger helpers and `user_preferences` orchestration pointers with lower-level ensure/create job helpers plus control-plane-owned active job refs.
- Convert match snapshot refresh to single-pass worker execution, remove rerun orchestration, and make enrichment worker outcomes explicit (`requestSatisfied`, `newCandidatesAvailable`, `local_limit`, `error`) so settlement flows through the control plane.
- Cut onboarding and extension sync over to semantic library-processing changes; sync emits one aggregated `library_synced` change per request and stops making scattered direct follow-on scheduling calls.
- Fix `src/lib/workflows/enrichment-pipeline/batch.ts` in the same change by replacing giant app-side exclusion lists with DB-side selectors that directly choose songs still needing work while preserving the current distinction between full-pipeline selection and data-enrichment-only selection.
- Add minimal durable execution measurement as a second pass immediately after the control-plane cutover, and expose derived `firstMatchReady` through the existing read-model path instead of storing it in `library_processing_state`.

## Capabilities

### New Capabilities
- `library-processing`: Central control plane for library-processing freshness, typed change application, queue-priority-aware job ensuring, and derived library-processing read-model signals.

### Modified Capabilities
- `background-enrichment-worker`: Workers report explicit enrichment and match-snapshot outcomes back to the control plane, claim jobs by queue priority, and record execution measurements after cutover.
- `data-flow`: Background orchestration state moves out of `user_preferences` pointers into `library_processing_state`-backed read models and active-job resolution.
- `extension-data-pipeline`: Sync computes one aggregated `library_synced` change per request and delegates follow-on scheduling to `applyLibraryProcessingChange(...)`.
- `onboarding`: Initial target selection emits onboarding library-processing changes instead of calling policy-shaped trigger helpers directly.
- `target-playlist-match-refresh`: Durable refresh execution is renamed around `match_snapshot_refresh`, becomes single-pass, and derives execution hints at ensure time rather than rerunning inline.
- `matching-pipeline`: Enrichment and refresh candidate selection moves to DB-side selectors/RPCs that preserve current full-pipeline vs data-enrichment semantics without giant app-side exclusion lists.

## Affected specs

- New spec: `library-processing`
- Modified spec: `background-enrichment-worker`
- Modified spec: `data-flow`
- Modified spec: `extension-data-pipeline`
- Modified spec: `onboarding`
- Modified spec: `target-playlist-match-refresh`
- Modified spec: `matching-pipeline`
- Modified spec: `re-matching`

## Impact

- Affected code: `src/lib/workflows/library-processing/*` (new), `src/lib/workflows/enrichment-pipeline/*`, `src/lib/workflows/match-snapshot-refresh/*`, `src/routes/api/extension/sync.tsx`, `src/lib/server/onboarding.functions.ts`, `src/lib/data/jobs.ts`, `src/lib/data/job-failures.ts`, `src/lib/platform/jobs/progress/types.ts`, `src/lib/domains/library/accounts/preferences-queries.ts`, `src/lib/server/jobs.functions.ts`, `src/worker/*`
- Affected data model: new `library_processing_state` table, new job request-marker column, new `queue_priority` column, new `match_snapshot_refresh` job type/helpers, DB-side selector RPCs, removal of old orchestration pointer fields from `user_preferences`, and follow-up execution-measurement storage
- Affected systems: Supabase migrations and RPCs, queue claim ordering, onboarding/save flows, extension sync follow-on scheduling, worker settlement paths, background progress read models, and match snapshot publication
- Migration/tooling impact: forward-only migrations created with `supabase migration new <name>` and validated as one coordinated hard-cut release
