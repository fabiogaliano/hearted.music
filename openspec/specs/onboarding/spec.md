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

#### Scenario: Value proposition displayed
- **WHEN** visitor views landing page
- **THEN** show visual of song analysis panel with themes/meaning

#### Scenario: Social proof
- **WHEN** visitor views landing page
- **THEN** show usage stats ("Already organized X songs for Y users")

---

### Requirement: Automatic Sync

The system SHALL automatically start syncing after Spotify OAuth.

#### Scenario: Sync starts without user action
- **WHEN** user completes Spotify OAuth
- **THEN** immediately begin syncing liked songs and playlists

#### Scenario: Progress displayed during sync
- **WHEN** sync is in progress
- **THEN** show real-time progress with checkmarks and counts

#### Scenario: Playlist preview during sync
- **WHEN** playlists are discovered
- **THEN** show scrolling list of playlist names and track counts

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

#### Scenario: Syncing interrupted
- **WHEN** user returns after leaving during sync
- **THEN** resume sync from where it stopped

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
  └─▶ LOGIN (oauth)
       │
       └─▶ SYNCING
            │ automatic
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
| Connecting | `connecting` | No |
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
-- Values: 'welcome', 'pick-color', 'connecting', 'syncing',
--         'flag-playlists', 'ready', 'complete'
```
