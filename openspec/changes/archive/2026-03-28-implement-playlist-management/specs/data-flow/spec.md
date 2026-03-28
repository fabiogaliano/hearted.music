## ADDED Requirements

### Requirement: `/playlists` uses route-level server data loading with browser-only extension detection
The system SHALL preload playlist server state at the route boundary while keeping extension-runtime detection in browser/client code.

#### Scenario: Route entry preloads playlist management data
- **WHEN** the user navigates to `/playlists`
- **THEN** the route loader preloads the server-derived playlist data needed to render matching playlists, available-library playlists, and detail-view reads
- **AND** the route does not defer that initial data loading to arbitrary child components

#### Scenario: Extension runtime checks stay in browser code
- **WHEN** `/playlists` needs to know whether the extension is installed, connected, or currently able to accept Spotify commands
- **THEN** that detection runs through browser/client runtime messaging rather than server-only route loaders
- **AND** the route does not attempt to call `chrome.runtime.sendMessage` from server execution paths

### Requirement: `/playlists` maintains a session-scoped change set for target-affecting follow-on work
The system SHALL use a client-side `/playlists` session model that lets optimistic route state diverge temporarily from query-backed server state while target-affecting follow-on work is being coalesced.

#### Scenario: Session state overlays query-backed state during active management
- **WHEN** the user changes matching membership or completes a supported optimistic metadata edit during an active `/playlists` session
- **THEN** the route renders the latest session state as the visible source of truth for that mounted session
- **AND** it MAY temporarily differ from the last query-backed server snapshot until reconciliation completes

#### Scenario: React unmount is the primary flush path
- **WHEN** the user navigates away from `/playlists` and the route unmounts normally
- **THEN** the route flushes one coalesced downstream refresh request for any staged target-affecting changes
- **AND** this React navigation-away or unmount path is treated as the primary reliable flush mechanism

#### Scenario: `pagehide` is a best-effort fallback
- **WHEN** the browser tab is closed, reloaded, or backgrounded while `/playlists` is active
- **THEN** the route attempts a best-effort flush through `pagehide` or an equivalent unload-safe fallback
- **AND** the system still treats the React unmount path as the primary reliable mechanism

#### Scenario: Flush failure does not block navigation
- **WHEN** the exit-time or `pagehide` flush fails or cannot complete before the browser tears down the page
- **THEN** the navigation or browser lifecycle event still completes
- **AND** the already-applied playlist-management state is not rolled back solely because the downstream refresh trigger was best-effort
