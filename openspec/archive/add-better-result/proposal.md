# Change: Add better-result foundations (Phase 1)

## Why
We need a shared Result/TaggedError foundation before refactoring service and data layers in later phases.

## What Changes
- Add `better-result` as the standard Result/TaggedError utility for server-side code.
- Define a shared TaggedError taxonomy for external APIs and job pipeline failures.
- Add shared Result helper utilities for Supabase and external API wrappers.

## Impact
- **Affected specs**: data-flow
- **Affected code**:
  - `package.json` (dependency)
  - `src/lib/errors/*` (error taxonomy)
  - `src/lib/utils/*` or `src/lib/errors/*` (Result helpers)
