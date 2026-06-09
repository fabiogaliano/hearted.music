# Task 04 — Relocate the `AnalysisContent` type

**Plan:** §6.0 (first bullet), §7.2 item 3 · **Recommended order:** step 6 · **Status:** [ ]

## Goal

A foundational type-only move so the new `lib` session modules (Task 05/06) can
reference `AnalysisContent` without importing from `src/features/...`. This is the
prerequisite that lets the onboarding-session contracts live in `lib` cleanly.

This is **type-only**: move the interface, repoint importers, leave the existing
`as AnalysisContent` read-path casts unchanged. The runtime `analysisContentSchema`
+ `parseAnalysisContent(...)` boundary parser is a separate read-path hardening,
**out of scope** here.

## Checklist

- [ ] Create `src/lib/domains/enrichment/content-analysis/analysis-content.ts` and move the `AnalysisContent` interface there verbatim from `src/features/liked-songs/types.ts`
- [ ] `src/features/liked-songs/types.ts` now **imports** `AnalysisContent` from the lib module instead of owning it
- [ ] Repoint remaining importers to the lib path:
  - [ ] landing/detail components that use `AnalysisContent`
  - [ ] `step-resolver.ts` → (will become the onboarding-session domain module in Task 05)
  - [ ] `src/lib/server/onboarding.functions.ts`
  - [ ] `src/lib/server/liked-songs.functions.ts`
- [ ] Confirm no `src/features/...` import remains for this type in `lib` modules
- [ ] Leave all existing `as AnalysisContent` casts untouched

## Files touched

`src/lib/domains/enrichment/content-analysis/analysis-content.ts` (new),
`src/features/liked-songs/types.ts`, landing/detail components,
`src/lib/server/onboarding.functions.ts`, `src/lib/server/liked-songs.functions.ts`.

## Dependencies

None. Unblocks Task 05.

## Related tests

No new tests; existing type-checking + suite must stay green (`bun run typecheck`).
