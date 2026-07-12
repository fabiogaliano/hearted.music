# Orchestration Deviation Log — Playlist-Creation Deepening

Plan: `claudedocs/playlist-creation-deepening-plan-2026-07-12.md`
Sequence: E → D → A → B → C

This log records decisions made during execution that were **not** spelled out in
the plan, with a one-line rationale each. Empty sections mean execution matched the
plan exactly.

## Orchestration-level decisions

- (none yet)

## Workstream E — paging constant

- Plan cites `draft-engine.ts` as living at `src/lib/server/draft-engine.ts`; the
  actual file is `src/lib/domains/playlists/draft-engine.ts` (already a pure-domain
  module, matching its own header comment). Placed the new
  `src/lib/domains/playlists/constants.ts` as a sibling of the real file, not
  under `src/lib/server/` — consistent with the plan's own precedent reference
  (`domains/library/liked-songs/constants.ts`) and with the doc comment's framing
  of the constant as domain interface, not server implementation.
- New hook-level test file placed at
  `src/features/playlists/create/__tests__/useCreatePlaylistDraft.test.tsx`
  (not `.ts`) since it needs a `QueryClientProvider` JSX wrapper, following the
  established pattern in `src/features/matching/__tests__/useMatchReviewCard.test.tsx`.
  `previewPlaylistDraft` (from `@/lib/server/playlist-draft.functions`) is mocked;
  the assertion reads `suggestionsOffset` off the mock's call args after each
  `refreshSuggestions()`, since the hook doesn't expose the offset directly.
- Retargeted only the single test named for "no overlap" paging
  (`"suggestionsOffset pages the suggestions window deeper into the ranked pool"`)
  to the shared constant, per the plan's singular reference to "the existing
  no-overlap suggestions-paging test." Left the unrelated literal `12`s elsewhere
  in `draft-engine.test.ts` (e.g. "suggestions contains up to 12 songs...") as
  literals — those assert a general behavior, not the paging contract itself.

## Workstream D — stub conformance

- (none yet)

## Workstream A — billing reader

- (none yet)

## Workstream B — workflow extraction

- (none yet)

## Workstream C — commit-flow hook

- (none yet)
