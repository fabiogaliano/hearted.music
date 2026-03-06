## MODIFIED Requirements

### Requirement: Automatic Sync

The system SHALL start syncing after the user installs the Chrome extension and triggers sync.

#### Scenario: Sync starts via extension
- **WHEN** user completes extension installation
- **AND** the extension has a valid API token (obtained via `externally_connectable` handoff)
- **THEN** the web app triggers a sync via extension messaging
- **AND** the extension fetches liked songs and playlists via Pathfinder API
- **AND** the extension POSTs data to `/api/extension/sync`

#### Scenario: Progress displayed during sync
- **WHEN** sync is in progress
- **THEN** show real-time progress with checkmarks and counts
- **AND** progress is driven by the existing SSE job infrastructure

#### Scenario: Playlist preview during sync
- **WHEN** playlists are discovered
- **THEN** show scrolling list of playlist names and track counts

---

### Requirement: Resumable Onboarding

The system SHALL allow users to resume onboarding after leaving.

#### Scenario: Extension install interrupted
- **WHEN** user returns after leaving during the extension install step
- **THEN** show extension install prompt again
- **AND** re-check if extension is now installed

#### Scenario: Syncing interrupted
- **WHEN** user returns after leaving during sync
- **THEN** check sync status from database
- **AND** if incomplete, prompt to re-trigger sync via extension

#### Scenario: Playlist selection interrupted
- **WHEN** user returns after leaving playlist selection
- **THEN** show selection screen again

## ADDED Requirements

### Requirement: Extension Installation Step

The system SHALL include an "Install Extension" step in the onboarding flow between Pick Color and Syncing.

#### Scenario: Extension not installed
- **WHEN** user reaches the install-extension onboarding step
- **AND** the extension is not detected
- **THEN** show a prompt explaining the extension requirement
- **AND** provide a link to the Chrome Web Store listing
- **AND** poll or listen for extension installation

#### Scenario: Extension already installed
- **WHEN** user reaches the install-extension onboarding step
- **AND** the extension is already detected
- **THEN** automatically advance to the syncing step

#### Scenario: Extension detected after install
- **WHEN** the extension is installed while the user is on the install-extension step
- **THEN** the system detects the installation
- **AND** automatically advances to the syncing step

## REMOVED Requirements

### Requirement: Landing Page
**Reason**: Landing page CTA previously said "Show me mine" and led to Spotify OAuth. The CTA now leads to social login (Google/Apple). The landing page itself is not removed but its connection to Spotify OAuth is severed.
**Migration**: Update landing page CTA to trigger social login instead of Spotify OAuth.
