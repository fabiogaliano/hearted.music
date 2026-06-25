# MSR-19 — Ordered undecided subjects and visibility hash idempotency

## Goal

Derive orientation-aware queue subjects using strictness score and idempotently append by visibility configuration.

## Depends on / blocks

Depends on:

- MSR-18
- MSR-02

Blocks:

- MSR-20
- MSR-22
- MSR-36

## Scope and out of scope

In scope:

- Implement `getOrderedUndecidedSubjects` with orientation, account, snapshot, and visibility hash input.
- Use `strictnessScore(row)` for max subject fit score and hidden counts.
- Preserve song-mode newness priority and use playlist-mode fit-score ordering.
- Set playlist-mode `was_new_at_enqueue = false`.
- Use stable `readTimeFiltersHash = "write-time-filters"` before read-time filters move.
- Update session snapshot idempotency writes to include visibility hash.

Out of scope:

- Read-time hard filter predicates.
- Visible suggestion capture.
- UI empty-state copy.

## Likely touchpoints

- `src/lib/domains/taste/match-review-queue/queries.ts`
- `src/lib/domains/taste/match-review-queue/service.ts`
- `src/lib/domains/taste/song-matching/queries.ts`
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` A7, E7, C9.
- Queue ordering is cross-subject and uses strictness/fused score, not reranker score.
- Visibility hash includes orientation and strictness now; filters expand later.

## Acceptance criteria

- Song-mode ordering still prioritizes newness then max strictness score then song id.
- Playlist-mode ordering uses max strictness score then playlist id.
- Reapplying same snapshot/hash is idempotent; future new hash can append without duplicating subjects.
- Hidden review item count is orientation-aware.

## Notes on risks or ambiguity

- The helper name says undecided subjects; avoid leaking song-only return names into new callers.
