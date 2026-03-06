## 1. Foundation

- [x] 1.1 Create `src/features/matching/types.ts` with shared prop interfaces (`MatchingProps`, `MatchingSessionProps`, `MatchingHeaderProps`, `CompletionScreenProps`, `CompletionStats`)
- [x] 1.2 Create `src/features/matching/hooks/useMatchingState.ts` with flat `MatchingState` object, all session handlers, and derived `isComplete` boolean

## 2. Session Sections

- [x] 2.1 Create `src/features/matching/sections/MatchingHeader.tsx` — progress bar and "N of M" counter
- [x] 2.2 Create `src/features/matching/sections/MatchingSession.tsx` — layout coordinator with `ResizeObserver`-based height animation for panel expand/collapse
- [x] 2.3 Create `src/features/matching/sections/CompletionScreen.tsx` — end-of-session stats screen (total reviewed, matched, additions, skipped)

## 3. Components

- [x] 3.1 Create `src/features/matching/components/DetailsPanel.tsx` — expandable panel with key lines, themes, and emotional journey (CSS max-height animation)
- [x] 3.2 Refactor `src/features/matching/components/MatchesSection.tsx` — ranked playlist list with hover-revealed Add button, Discard and Next Song controls
- [x] 3.3 Refactor `src/features/matching/components/SongSection.tsx` — album art and song metadata with rAF-based blur+fade re-entrance animation on panel toggle

## 4. Orchestrator and Route

- [x] 4.1 Create `src/features/matching/Matching.tsx` — top-level orchestrator wiring `useMatchingState`, songs/playlists from mock data, and all sections
- [x] 4.2 Update `src/routes/_authenticated/match.tsx` — simplify to mount `<Matching onExit={...} />` with TanStack Router `useNavigate` for exit
