# Matching UI Specification

> Progressive view system for the song-to-playlist matching experience.

**Detailed design**: `docs/MATCHING-UI-DECISION.md`

---

## Release Order

| Phase | View | Priority | Status |
|-------|------|----------|--------|
| **MVP** | Split View | P0 | Next |
| **v1.1** | Card Stack | P1 | Planned |
| **v1.2** | Timeline/Feed | P2 | Planned |

---

## Requirements

### Requirement: View Toggle

The system SHALL allow users to switch between available matching views.

#### Scenario: Toggle displayed
- **WHEN** user is on the Sort page
- **THEN** show view toggle with icons for Split, Card, Timeline

#### Scenario: Unavailable views disabled
- **WHEN** view is not yet implemented
- **THEN** show icon as disabled with "Coming soon" tooltip

#### Scenario: Preference persisted
- **WHEN** user selects a view
- **THEN** save to `user_preferences.matching_view`

---

### Requirement: Split View (MVP)

The system SHALL provide a split-panel matching interface.

#### Scenario: Layout structure
- **WHEN** user views Split View
- **THEN** show song panel on left, playlist matches on right

#### Scenario: Song panel content
- **WHEN** viewing current song
- **THEN** show: album art, title, artist, audio player, mood tags, genre tags

#### Scenario: Matches panel content
- **WHEN** viewing playlist matches
- **THEN** show ranked list with: playlist name, match score, match factors, Add button

#### Scenario: Add to playlist action
- **WHEN** user clicks Add on a match
- **THEN** add song to playlist, animate success, advance to next song

#### Scenario: Skip action
- **WHEN** user clicks Skip
- **THEN** mark song as ignored, advance to next song

---

### Requirement: Card Stack View (v1.1)

The system SHALL provide a swipeable card interface for mobile.

#### Scenario: Tinder-like interaction
- **WHEN** user views Card Stack
- **THEN** show current song as card with swipe gestures

#### Scenario: Swipe right to add
- **WHEN** user swipes right on card
- **THEN** add to best matching playlist

#### Scenario: Swipe left to skip
- **WHEN** user swipes left on card
- **THEN** mark song as ignored

#### Scenario: Tap for details
- **WHEN** user taps card
- **THEN** expand to show match details and playlist options

---

### Requirement: Timeline View (v1.2)

The system SHALL provide a feed-style browsing interface.

#### Scenario: Vertical scroll feed
- **WHEN** user views Timeline
- **THEN** show songs in vertical scrolling feed

#### Scenario: Inline actions
- **WHEN** viewing song in feed
- **THEN** show quick-add buttons for top 3 matching playlists

#### Scenario: Best for maintenance
- **WHEN** few new songs trickle in
- **THEN** Timeline is optimal for casual browsing

---

### Requirement: Shared State Across Views

The system SHALL share matching state across all view types.

#### Scenario: Same data source
- **WHEN** switching between views
- **THEN** all views use same query hooks and mutations

#### Scenario: Queue position preserved
- **WHEN** switching views mid-session
- **THEN** continue from current song

#### Scenario: Only presentation changes
- **WHEN** implementing new view
- **THEN** reuse existing hooks: `useMatches()`, `useTracks()`, `useAddToPlaylist()`

---

### Requirement: Session progress indicator

The system SHALL show users where they are in the matching queue at all times.

#### Scenario: Progress displayed
- **WHEN** user is in a matching session
- **THEN** show a count of current position vs total songs (e.g., "3 of 47")

#### Scenario: Progress bar shown
- **WHEN** user is in a matching session
- **THEN** show a visual progress bar reflecting songs reviewed / total songs

---

### Requirement: Multi-add support

The system SHALL allow a song to be added to more than one playlist before advancing.

#### Scenario: Multiple additions per song
- **WHEN** user clicks Add on a playlist match
- **THEN** song is added to that playlist without advancing to the next song

#### Scenario: Explicit advancement
- **WHEN** user has added to at least one playlist
- **THEN** a "Next Song" button SHALL be available to advance

#### Scenario: Discard option
- **WHEN** user does not want to add a song to any playlist
- **THEN** a "Discard" button SHALL advance to the next song without adding

---

### Requirement: Song analysis details panel

The system SHALL provide an expandable panel showing AI-generated song analysis.

#### Scenario: Panel collapsed by default
- **WHEN** a new song is presented
- **THEN** the details panel is collapsed

#### Scenario: Panel expands on request
- **WHEN** user activates the "Explore" control
- **THEN** the details panel expands to show key lines, themes, and emotional journey

#### Scenario: Panel collapses on dismiss
- **WHEN** user dismisses the details panel
- **THEN** it collapses and the song view returns to focus

#### Scenario: Emotional journey interactive
- **WHEN** user hovers over a journey step in the details panel
- **THEN** that step is highlighted

---

### Requirement: Session completion screen

The system SHALL show a summary screen when all songs in the queue have been reviewed.

#### Scenario: Completion triggered
- **WHEN** user advances past the last song
- **THEN** the session view is replaced by a completion screen

#### Scenario: Stats displayed
- **WHEN** completion screen is shown
- **THEN** show: total songs reviewed, songs matched (added to at least one playlist), total playlist additions, songs skipped

#### Scenario: Exit after completion
- **WHEN** user is on the completion screen
- **THEN** an exit control navigates away from the match route

---

## Component Structure

```typescript
// features/matching/views/
├── SplitView.tsx      // MVP
├── CardStackView.tsx  // v1.1
├── TimelineView.tsx   // v1.2
└── index.tsx          // View switcher

// features/matching/MatchingPage.tsx
export function MatchingPage() {
  const { view } = useMatchingPreferences()

  return (
    <MatchingLayout>
      {view === 'split' && <SplitView />}
      {view === 'card' && <CardStackView />}
      {view === 'timeline' && <TimelineView />}
    </MatchingLayout>
  )
}
```

---

## View Toggle Component

```typescript
const views = [
  { id: 'split', icon: '📊', label: 'Split View', available: true },
  { id: 'card', icon: '🃏', label: 'Card Stack', available: false },
  { id: 'timeline', icon: '📰', label: 'Timeline', available: false },
]
```

---

## Database

```sql
-- user_preferences table
matching_view TEXT DEFAULT 'split'
CHECK (matching_view IN ('split', 'card', 'timeline'))
```
