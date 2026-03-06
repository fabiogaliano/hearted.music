# Onboarding Flow Specification

> First-time user experience that leads to the "aha moment".

**Detailed design**: `docs/ONBOARDING-FLOW.md`

---

## Principles

1. **Value Before Configuration** - Show the magic before asking for setup
2. **Progressive Commitment** - Small asks → bigger asks as trust builds
3. **Immediate Feedback** - Something happens right away
4. **Guided Not Blocked** - Suggest, don't force

---

## Requirements

### Requirement: Landing Page

The system SHALL display a compelling landing page before login.

#### Scenario: Single clear CTA
- **WHEN** visitor views landing page
- **THEN** show one primary CTA: "Show me mine"
- **AND** CTA triggers social login (Google) via Better Auth

#### Scenario: Value proposition displayed
- **WHEN** visitor views landing page
- **THEN** show visual of song analysis panel with themes/meaning

#### Scenario: Social proof
- **WHEN** visitor views landing page
- **THEN** show usage stats ("Already organized X songs for Y users")

---

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

---

### Requirement: Playlist Flagging Step

The system SHALL require users to select destination playlists.

#### Scenario: Selection UI displayed
- **WHEN** sync completes
- **THEN** show grid of playlists with checkboxes

#### Scenario: Minimum selection required
- **WHEN** user tries to continue
- **THEN** require at least 1 playlist selected (or allow skip)

#### Scenario: Helpful guidance
- **WHEN** user views playlist selection
- **THEN** show hint: "Pick playlists that have a clear theme or mood"

---

### Requirement: First Match Demo

The system SHALL demonstrate matching before asking for API key.

#### Scenario: Free demo analysis
- **WHEN** user completes playlist flagging
- **THEN** automatically analyze one song for free (app pays)

#### Scenario: Show the magic
- **WHEN** demo analysis completes
- **THEN** show mood, genre, themes, AND best matching playlist with score

#### Scenario: API key prompt after value
- **WHEN** demo completes successfully
- **THEN** prompt for API key with "To analyze more songs..."

---

### Requirement: Optional API Key Setup

The system SHALL allow skipping API key setup.

#### Scenario: Skip option available
- **WHEN** user views API key step
- **THEN** show "Skip for now" link

#### Scenario: Guidance for free option
- **WHEN** user wants to set up API key
- **THEN** recommend Google AI (free tier) with step-by-step instructions

#### Scenario: Immediate validation
- **WHEN** user enters API key
- **THEN** validate and show success/error inline

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

#### Scenario: API key skipped
- **WHEN** user skipped API key setup
- **THEN** show prompt to add key from settings later

---

## State Machine

```
LANDING
  │
  └─▶ LOGIN (social oauth)
       │
       └─▶ INSTALL_EXTENSION
            │ detect or prompt
            ▼
         SYNCING
            │ extension-triggered
            ▼
         FLAG_PLAYLISTS
            │ must select ≥1 or skip
            ▼
         FIRST_MATCH
            │ show demo analysis
            ▼
         API_KEY_SETUP
            │ optional
            ▼
         DASHBOARD
```

---

## Onboarding Steps

| Step | `onboarding_step` Value | Can Skip |
|------|-------------------------|----------|
| Welcome | `welcome` | No |
| Pick Color | `pick-color` | No |
| Install Extension | `install-extension` | No |
| Syncing | `syncing` | No |
| Flag Playlists | `flag-playlists` | Yes |
| Ready | `ready` | No |
| Complete | `complete` | — |

---

## Skip Handling

| Step | Skip Behavior |
|------|---------------|
| Flag playlists | Go to dashboard, show reminder banner |
| First match | Go directly to API key setup |
| API key | Go to dashboard, show "Add API key to analyze" prompt |

---

## Database Changes

```sql
-- user_preferences table
onboarding_step TEXT DEFAULT 'welcome'
-- Values: 'welcome', 'pick-color', 'install-extension', 'syncing',
--         'flag-playlists', 'ready', 'complete'
```
