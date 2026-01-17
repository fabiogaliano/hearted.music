# Change: Refactor Spotify service to Result patterns (Phase 2)

## Why
With Result foundations in place, the Spotify service needs Result-based pagination and retry so its failures are composable and maintainable.

## What Changes
- Introduce Result-based request, retry, and pagination helpers in `lib/services/spotify/*`.
- Update SpotifyService methods to return `Result<T, SpotifyError>` instead of throwing.
- Map Spotify entities to migration-v2-aligned insert shapes (transform-only; persistence stays in the data layer).

## Impact
- **Affected specs**: data-flow
- **Affected code**:
  - `src/lib/services/spotify/*`
  - `src/lib/errors/*` (Spotify TaggedError usage)
