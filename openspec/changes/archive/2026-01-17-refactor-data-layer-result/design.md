## Context
Phase 1 establishes Result helpers and TaggedError taxonomy. Phase 2 refactors the Spotify service. This phase aligns data modules and route boundaries with Result-based flow.

## Goals / Non-Goals
- Goals:
  - Return Result values from `lib/data/*` modules.
  - Compose multi-step flows with `Result.gen()` and `Result.await()`.
  - Translate Result failures at route boundaries into redirects or typed error responses.
- Non-Goals:
  - Rewriting UI error handling patterns.
  - Changing OAuth redirect semantics.

## Decisions
- Decision: Data modules return `Result.err(TaggedError)` instead of throwing.
- Decision: Route boundaries map auth errors to `redirect()` and other errors to structured payloads.
- Decision: Pipelines use `Result.gen()` for composition.

## Risks / Trade-offs
- Broad refactor across data modules -> Mitigate with incremental updates and shared helpers.

## Migration Plan
1. Convert data modules to Result return types.
2. Update call sites to use Result composition.
3. Update route boundaries for Result translation.

## Open Questions
- Which TaggedError tags should trigger auth redirects?
