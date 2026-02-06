# Liked Songs UI

Browse, filter, and inspect liked songs library.

## ADDED Requirements

### Requirement: Liked Songs List View

The application SHALL provide a paginated list view of the user's liked songs with infinite scroll.

**Acceptance Criteria:**
- Songs display with album art, title, artist, and analysis status
- Infinite scroll loads more songs as user scrolls
- Filter tabs: All, Pending, Matched, Analyzed
- Stats header shows total/analyzed/pending counts

#### Scenario: User views liked songs list

```gherkin
Given a user navigates to /liked-songs
When the page loads
Then the first page of liked songs is displayed
And stats show total, analyzed, and pending counts
And filter is set to "all" by default
```

#### Scenario: User scrolls to load more songs

```gherkin
Given the user is viewing the liked songs list
When they scroll near the bottom
Then the next page of songs loads automatically
And a loading indicator shows during fetch
```

#### Scenario: User filters songs by status

```gherkin
Given the user is viewing the liked songs list
When they click a filter tab (pending/matched/analyzed)
Then the list updates to show only matching songs
And the URL updates with the filter parameter
```

### Requirement: Song Detail Panel

The application SHALL provide an expandable detail panel for viewing full song analysis.

**Acceptance Criteria:**
- Panel opens with FLIP animation from card position
- Hero section with album art, title, artist
- Collapsible hero on scroll (450px → 108px)
- Sections: Audio Info, Meaning, Context, Playlists
- Dark mode toggle (Cmd+D)
- Deep linking via `?song=<slug>` URL parameter

#### Scenario: User expands a song to view details

```gherkin
Given the user is viewing the liked songs list
When they click a song card (or press Enter on focused card)
Then the detail panel opens with FLIP animation
And the URL updates to include ?song=<slug>
And the hero section displays album art and track info
```

#### Scenario: User scrolls within detail panel

```gherkin
Given the detail panel is open
When the user scrolls down
Then the hero section collapses progressively (450px → 108px)
And the album art shrinks to header size
And scroll position is preserved within sections
```

#### Scenario: User closes the detail panel

```gherkin
Given the detail panel is open
When the user presses Escape (or clicks outside)
Then the panel closes with reverse animation
And the URL removes the ?song parameter
And focus returns to the song card
```

### Requirement: Keyboard Navigation

The application SHALL support keyboard navigation for efficient browsing.

**Acceptance Criteria:**
- j/k: Move focus up/down in list
- Enter: Open detail panel for focused song
- Escape: Close detail panel
- j/k in panel: Navigate to prev/next song
- Cmd+D: Toggle dark mode in panel

#### Scenario: User navigates list with keyboard

```gherkin
Given the user is focused on the song list
When they press j or k
Then focus moves to the next or previous song
And the focused song is visually indicated
```

#### Scenario: User navigates between songs in panel

```gherkin
Given the detail panel is open
When the user presses j or k
Then the panel animates to the next or previous song
And the URL updates to the new song's slug
```
