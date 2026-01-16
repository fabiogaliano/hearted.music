# Design: Spotify SDK Services

## Context

We are porting the v0 Spotify SDK integration patterns (SDK factory, retry, pagination, service class) into v1 while preserving the existing Supabase-backed token storage and PKCE OAuth flow. Services should live under `src/lib/services` to match the migration-v2 service organization intent.

## Goals

- Provide a Spotify service layer backed by the SDK
- Keep token exchange/refresh logic in the existing raw fetch client
- Add retry + pagination helpers for common Spotify endpoints
- Prevent duplicate token refreshes under parallel access
- Consolidate service modules under `src/lib/services`

## Non-Goals

- Replacing the OAuth flow or cookie/session model
- Introducing new database tables or schema changes
- Client-side token handling

## Decisions

### D1: Raw token client remains source of truth
**Decision**: Keep token exchange/refresh implemented with fetch against Spotify token endpoints.
**Rationale**: v1 already stores tokens in Supabase and uses PKCE. The SDK is not responsible for token exchange.

### D2: SDK used only after access token is validated
**Decision**: Create a Spotify SDK instance using the access token from Supabase.
**Rationale**: Keeps token lifecycle centralized in the token client while enabling SDK ergonomics for API calls.

### D3: Service modules live under `src/lib/services`
**Decision**: Move Spotify modules into `src/lib/services/spotify/` and relocate any other service modules there if present.
**Rationale**: Aligns with the service layer direction described in migration docs and keeps the codebase organized.

### D4: Retry and pagination helpers are part of the service
**Decision**: Port `fetchWithRetry` (429 + Retry-After) and `fetchPaginatedData` patterns from v0 into the new `SpotifyService`.
**Rationale**: Prevents duplicated logic and standardizes rate-limit handling.

### D5: Refresh coordination per account
**Decision**: Maintain a per-account refresh promise map to deduplicate concurrent refreshes.
**Rationale**: Avoids multiple refresh requests when parallel server functions access Spotify.

## Risks / Trade-offs

- **SDK dependency size**: Adds bundle weight; mitigated by server-only usage.
- **In-memory refresh coordination**: Works per runtime instance; acceptable for current scale.

## Migration Plan

1. Add SDK dependency.
2. Create `src/lib/services/spotify/` directory.
3. Move the existing token client into that folder and update imports.
4. Add SDK factory and `SpotifyService` class.
5. Add refresh coordination in the token client helper.
6. Update any callers to use `getSpotifyService(accountId)` or SDK factory.

## Open Questions

- Which Spotify endpoints should be ported first beyond liked tracks/playlists?
