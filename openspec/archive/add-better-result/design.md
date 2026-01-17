## Context
Migration v2 introduces multi-stage jobs and external API calls. We need a shared Result/TaggedError foundation before refactoring services and data modules in later phases.

## Goals / Non-Goals
- Goals:
  - Add the `better-result` dependency for server-side Result handling.
  - Provide a stable TaggedError taxonomy for external APIs and job failures.
  - Add shared Result helper utilities for Supabase and external API wrappers.
- Non-Goals:
  - Refactoring query modules or services to return Result values.
  - Translating Result errors at route boundaries.
  - Rewriting UI error handling patterns.

## Decisions
- Decision: Adopt `better-result` for `Result<T, E>` and `TaggedError` usage in server-side modules.
- Decision: Define shared TaggedError subclasses for external API and pipeline failures.
- Decision: Provide helper wrappers for Supabase and external API calls to reduce boilerplate.

## Risks / Trade-offs
- Mixed throw + Result semantics until later phases -> Mitigate with follow-on refactors.

## Migration Plan
1. Add dependency and shared error helpers.
2. Introduce TaggedError taxonomy.
3. Use helpers in follow-on phases to refactor services and data modules.

## Open Questions
- What TaggedError categories are required for Spotify vs DeepInfra vs Supabase?
- Where should error helpers live (`src/lib/errors` vs `src/lib/utils`)?
- Should job_failure persist full error payloads or summaries?
