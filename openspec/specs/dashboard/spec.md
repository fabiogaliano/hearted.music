# Dashboard Layout Specification

> Main application interface after onboarding.

**Detailed design**: `docs/DASHBOARD-LAYOUT.md`

---

## Requirements

### Requirement: Sidebar Navigation

The system SHALL provide a persistent sidebar with navigation, status, and credits.

#### Scenario: Navigation items displayed
- **WHEN** user is on any authenticated page
- **THEN** sidebar shows: Home, Sort Songs (with badge), Liked Songs, Playlists

#### Scenario: Sort Songs badge shows count
- **WHEN** there are new songs to sort
- **THEN** Sort Songs nav item shows badge with count

#### Scenario: Status section displays sync info
- **WHEN** user views sidebar
- **THEN** status section shows last sync time and analysis progress

#### Scenario: Credits section displays balance
- **WHEN** user views sidebar
- **THEN** credits section shows remaining credits with progress bar

---

### Requirement: Settings as Modal

The system SHALL display settings in a modal overlay, not as a navigation tab.

#### Scenario: Settings accessed via user menu
- **WHEN** user clicks user avatar in sidebar
- **THEN** dropdown shows settings option that opens modal

#### Scenario: Settings modal sections
- **WHEN** settings modal opens
- **THEN** shows tabs for: Account, AI Keys, Display, Sync

---

### Requirement: Home Page Timeline

The system SHALL display a single-column timeline on the home page.

#### Scenario: Ready to match CTA
- **WHEN** user has new songs to sort
- **THEN** show hero CTA with fan-spread album art and "Start" button

#### Scenario: No new songs state
- **WHEN** user has no new songs
- **THEN** hide the CTA, focus on activity feed

#### Scenario: Flagged playlists row
- **WHEN** user has flagged playlists
- **THEN** show horizontal row of playlist cards with "Manage" link

#### Scenario: Recent activity feed
- **WHEN** user has recent matching activity
- **THEN** show timeline of matched songs with playlist destinations

---

### Requirement: Sort Songs Page

The system SHALL provide a dedicated page for the matching experience.

#### Scenario: Split view as MVP
- **WHEN** user visits /app/sort
- **THEN** show split view with current song on left, playlist matches on right

#### Scenario: View toggle available
- **WHEN** user views sort page
- **THEN** show toggle for Split/Card/Feed views (Card and Feed disabled until v1.1/v1.2)

#### Scenario: Song details display
- **WHEN** viewing current song
- **THEN** show album art, title, artist, mood tags, genre tags, audio player

#### Scenario: Playlist matches display
- **WHEN** viewing playlist matches
- **THEN** show ranked list with match percentage, reason, and Add button

---

### Requirement: Library Pages

The system SHALL provide pages for browsing songs and playlists.

#### Scenario: Liked Songs table
- **WHEN** user visits /app/library/songs
- **THEN** show paginated table with columns: Track, Artist, Album, Status, Actions

#### Scenario: Playlists grid
- **WHEN** user visits /app/library/playlists
- **THEN** show grid with flagged playlists section first, then other playlists

#### Scenario: Status indicators
- **WHEN** viewing songs table
- **THEN** show status badges: Sorted, Pending, New

---

### Requirement: Mobile Responsive Layout

The system SHALL adapt layout for mobile devices.

#### Scenario: Collapsed sidebar on mobile
- **WHEN** viewport is mobile-sized
- **THEN** sidebar collapses to hamburger menu

#### Scenario: Bottom navigation on mobile
- **WHEN** viewport is mobile-sized
- **THEN** show bottom nav bar with Home, Sort, Library, Settings icons

---

## Route Structure

| URL | Route File | Description |
|-----|------------|-------------|
| `/` | `index.tsx` | Landing (public) |
| `/login` | `login.tsx` | Spotify OAuth |
| `/onboarding` | `onboarding.tsx` | New user flow |
| `/app` | `_app/index.tsx` | Home (smart suggestions) |
| `/app/sort` | `_app/sort.tsx` | Matching interface |
| `/app/library/songs` | `_app/library/songs.tsx` | Liked songs table |
| `/app/library/playlists` | `_app/library/playlists.tsx` | Playlist management |

---

## Component Structure

```
features/
├── layout/
│   ├── Sidebar.tsx
│   ├── SidebarNav.tsx
│   ├── SidebarStatus.tsx
│   ├── SidebarCredits.tsx
│   ├── UserMenu.tsx
│   ├── MobileNav.tsx
│   └── SettingsModal.tsx
├── home/
│   └── HomeTimeline.tsx
├── sort/
│   ├── SortPage.tsx
│   ├── ViewToggle.tsx
│   └── views/
│       ├── SplitView.tsx
│       ├── CardView.tsx
│       └── FeedView.tsx
└── library/
    ├── songs/
    │   └── SongsTable.tsx
    └── playlists/
        └── PlaylistGrid.tsx
```
