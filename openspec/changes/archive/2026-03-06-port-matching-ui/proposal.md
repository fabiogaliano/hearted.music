## Why

The match route existed as a thin placeholder. The `matching-ui` spec defines the full matching experience but no working session UI had been built. This change implements the MVP split-view matching session — the core interaction loop where a user reviews songs one-by-one and assigns them to playlists.

## What Changes

- New `Matching.tsx` orchestrator component wiring songs, state, and sections together
- New `useMatchingState` hook encapsulating all session state (current index, added-to map, panel visibility, journey hover)
- New `types.ts` for shared prop interfaces across the matching feature
- New sections: `MatchingHeader` (progress), `MatchingSession` (layout coordinator), `CompletionScreen` (end-of-session stats)
- New `DetailsPanel` component for expandable song analysis (key lines, themes, emotional journey)
- Refactored `MatchesSection` and `SongSection` to fit the new component hierarchy
- Updated `match.tsx` route to mount `Matching` with a router-based `onExit` handler

## Capabilities

### New Capabilities

_(none — this implements an existing planned capability)_

### Modified Capabilities

- `matching-ui`: Implements the Split View MVP from the spec. The session loop (one song at a time, add/discard/next), progress header, details panel, and completion screen are now built. View toggle, Card Stack, and Timeline views remain unbuilt.

## Impact

- `src/features/matching/` — all new files (Matching.tsx, types.ts, hooks/useMatchingState.ts, sections/*, components/DetailsPanel.tsx)
- `src/features/matching/components/` — MatchesSection and SongSection refactored
- `src/routes/_authenticated/match.tsx` — simplified to mount `<Matching onExit={...} />`
- Uses `@/lib/data/mock-data` for songs and playlists (real data hookup is out of scope)
