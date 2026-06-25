# Orchestration deviation log — match-system-refactor

Run start commit: `bc257dda`
Date: 2026-06-25

This log records decisions made during orchestrated execution that were **not** spelled out in the plan, plus any unresolved issues left after the bounded patch loop.

## Format

`- [MSR-XX] decision — one-line rationale`

## Entries

- [MSR-01] `MatchReviewSummaryResult` defined in domain `types.ts` alongside the existing server-local `MatchReviewSummaryResult` in `match-review-queue.functions.ts` — two types with the same name exist in different modules temporarily; the story's compile-safe-adapter clause permits this until a later story migrates callers.
- [MSR-03] All existing callers of `review(accountId, orientation)` and `summary(accountId, orientation)` now pass `'song'` explicitly (song-only app state) rather than using a root prefix key — keeps invalidation scoped to the currently-active orientation and avoids invalidating playlist-orientation keys before they exist.
- [MSR-02] `maxScore` accumulation in `deriveUndecidedSongsForQueue` was also migrated to use `strictnessScore(mr)` (not only the filter line) — maxScore drives queue ordering so it must reflect the same quality signal shown to the user, not the legacy ordering score.
- [MSR-02] `deriveUndecidedSongs` in `src/lib/server/matching.functions.ts` still reads `mr.score` directly for both strictness filter and maxScore — remaining caller to migrate in a later story (MSR-12 or MSR-18).
- [MSR-04] Playlist orientation rerank instruction string invented as "Given a song's mood and themes, judge if this playlist is a good home for it." — the plan specifies the map key `RERANK_INSTRUCTION_BY_ORIENTATION` but does not specify the playlist instruction text; MSR-13/14 can override the string if a better one is decided before that story lands.
