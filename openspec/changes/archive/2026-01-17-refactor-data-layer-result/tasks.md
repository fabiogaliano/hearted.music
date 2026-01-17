# Tasks: Refactor data layer and route boundaries to Result patterns (Phase 3)

## 1. Data layer refactor
- [x] 1.1 Update `src/lib/data/*` modules to return `Result<T, DbError>`
- [x] 1.2 Update callers to compose with `Result.gen()` / `Result.await()`

## 2. Route boundary translation
- [x] 2.1 Map auth-related Result errors to `redirect()` at boundaries
- [x] 2.2 Return typed error payloads for recoverable failures

## 3. Validation
- [x] 3.1 Update tests for Result-based data/route flows
- [x] 3.2 Run `openspec validate refactor-data-layer-result --strict --no-interactive`
