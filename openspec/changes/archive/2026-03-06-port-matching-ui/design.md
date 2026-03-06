## Context

The `matching-ui` spec defines a multi-view matching experience (Split/Card/Timeline) with a view toggle and DB-persisted preferences. Before this change, `src/routes/_authenticated/match.tsx` was a thin placeholder with no working session UI. The goal is to ship the MVP split-view session loop against mock data before wiring up real Supabase/Spotify data.

## Goals / Non-Goals

**Goals:**
- Working session loop: present songs one-by-one, allow multi-add and discard, advance
- Progress header showing current position in queue
- Expandable details panel for AI song analysis
- Completion screen with session stats
- Clean feature structure under `src/features/matching/` that can be extended

**Non-Goals:**
- View toggle (Split/Card/Timeline) — spec v1.1+
- Real data hookup (`useMatches`, `useTracks`, Supabase mutations) — next change
- User preference persistence (`user_preferences.matching_view`) — deferred
- Audio player in song panel — not in MVP scope

## Decisions

### Flat `MatchingState` object in a single hook

A single `useState<MatchingState>` in `useMatchingState` holds all session state: `currentIndex`, `addedTo`, `showMeaning`, `activeJourneyStep`, `songMetaVisible`. Alternative was multiple separate `useState` calls or a `useReducer`.

**Rationale**: The state is small and changes together often (advancing resets multiple fields). A flat object keeps state transitions explicit and co-located. `useReducer` would add verbosity without benefit at this scale.

### `sections/` over `views/` file structure

The spec's `Component Structure` section specifies `features/matching/views/` (SplitView, CardStackView, etc.). This change uses `features/matching/sections/` instead.

**Rationale**: The `views/` model implies multiple parallel view implementations. Since only one view is being built now, the split would create a premature abstraction. `sections/` reflects actual composition: `MatchingHeader`, `MatchingSession`, `CompletionScreen` are layout sections, not view variants. When Card Stack is built, a `views/` layer can be introduced with the `Matching` orchestrator acting as the switcher.

### `requestAnimationFrame` for song text re-entrance

When the details panel opens or closes, `songMetaVisible` is set false, then re-set true in a rAF callback. This triggers a blur+fade+translateY animation on the song text in `SongSection`.

**Rationale**: Directly toggling the class would not trigger a CSS transition because the element is already in the "shown" state. The rAF double-flip forces the browser to paint the hidden state before re-showing, giving the transition a start point to animate from.

### `ResizeObserver` for panel height animation

`MatchingSession` uses a `ResizeObserver` on the inner grid to sync explicit `height` onto the wrapper div, enabling a `will-change: height` CSS transition as the `DetailsPanel` expands.

**Rationale**: CSS `height: auto` cannot be animated. Rather than computing height in JS on every render, the observer fires only when content actually changes size. `will-change: height` hints to the browser to promote the wrapper to its own layer.

### Mock data, no mutations

Songs and playlists come from `@/lib/data/mock-data`. The `handleAdd` handler updates local state only — nothing is persisted.

**Rationale**: Wiring to Supabase and real Spotify data requires auth, query hooks, and mutation logic that is out of scope for this change. Mock data lets the UI be validated in isolation first.

## Risks / Trade-offs

- **Mock data gap**: `matchScore` on playlists is a static field, not computed per-song. Real matching scores will require a different data shape — `handleAdd` will need to write to the DB. → Mitigation: Keep the state shape simple so mutations can be injected at the call sites in `Matching.tsx`.
- **`handleReset` not wired**: Exported from the hook but not called anywhere in the UI. The completion screen only has an exit button. → Mitigation: Low risk for now; wire it if a "restart session" UX is added.
- **`CompletionScreen` thumbnails use `songs.slice(0, 5)`** not the actual matched songs from `state.addedTo`. → Mitigation: Fix when wiring real data — the `completionStats` passed down already contains the correct counts.

## Open Questions

- Should `handleSkip` vs `handleNext` remain semantically distinct at the state level, or is the current "both call the same logic" approach sufficient?
- When Card Stack view is introduced, does `Matching.tsx` become the view switcher, or does a new `MatchingPage.tsx` wrap it per the spec's design?
