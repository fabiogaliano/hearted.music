# Change: Refactor data layer and route boundaries to Result patterns (Phase 3)

## Why
After Spotify service returns Result, the data layer and route boundaries must adopt Result for consistent error propagation and translation.

## What Changes
- Update `lib/data/*` query modules to return Result types and TaggedError mapping.
- Compose multi-step pipelines with `Result.gen()` and `Result.await()`.
- Translate Result failures at route/server-function boundaries into redirects or structured error responses (boundaries stay thin; composition happens in services/pipelines).

## Impact
- **Affected specs**: data-flow
- **Affected code**:
  - `src/lib/data/*`
  - `src/routes/*`
  - pipeline/orchestrator modules
