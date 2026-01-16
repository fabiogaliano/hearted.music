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
