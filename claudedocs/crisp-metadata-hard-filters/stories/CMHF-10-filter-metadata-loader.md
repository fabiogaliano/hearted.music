# CMHF-10 — Filter metadata loader for match refresh

## Goal

Load the compact song and account-scoped liked-date metadata needed to evaluate hard filters during match snapshot refresh.

## Depends on / blocks

- Depends on: CMHF-01 and CMHF-02.
- Blocks: CMHF-11.

## Scope

In scope:

- Add a compact metadata loader for candidate song IDs in match refresh.
- Load from `song`: `id`, `language`, `language_secondary`, `release_year`, `vocal_gender`.
- Load from active `liked_song` rows for the current account: `song_id`, `liked_at`, with `unliked_at IS NULL`.
- Return typed maps keyed by song ID for efficient pair evaluation.
- Add failure handling shape so match refresh can distinguish filter metadata degradation from invalid stored filters.
- Add tests for active liked-row scoping, missing rows, chunking if needed, and typed mapping.

Out of scope:

- Pair exclusion computation.
- Orchestrator union/plumbing.
- Base exclusion loading changes.
- User-facing counts or reasons.

## Likely touchpoints

- New helper under `src/lib/workflows/match-snapshot-refresh/` or a domain-adjacent module.
- `src/lib/domains/library/songs/queries.ts`
- `src/lib/domains/library/liked-songs/queries.ts`
- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts` only if wiring the loader behind a feature-internal helper.
- Tests near match-refresh helpers.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 4, 5, and 8.

- `liked_at` is account-song relationship data, not global song metadata.
- Only active liked rows (`unliked_at IS NULL`) are eligible for liked-date filters.
- Metadata loading failure should allow a degraded refresh that skips filter exclusions.
- Do not modify account-global candidate RPC for per-playlist filters.

## Acceptance criteria

- Loader accepts `accountId` and candidate song IDs and returns compact typed metadata maps.
- Song metadata is loaded once per refresh, not per playlist or per pair.
- Active liked rows are account-scoped and exclude unliked rows.
- Missing metadata is represented explicitly so predicates can fail active filters.
- Loader failures are observable to CMHF-12 as filter-metadata degradation.
- Relevant `bun run test` coverage passes.

## Notes on risks or ambiguity

- Candidate sets can be large; use chunking or compact selects if needed.
- Do not accidentally include liked rows for another account.
