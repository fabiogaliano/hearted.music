# Onboarding Flow Specification Deltas

**Status**: ✅ IMPLEMENTED

---

## MODIFIED Requirements

### Requirement: Automatic Sync

The system SHALL automatically start syncing after Spotify OAuth and display real-time progress with per-phase counts.

#### Scenario: Sync starts without user action
- **WHEN** user completes Spotify OAuth
- **THEN** immediately begin syncing liked songs, playlists, and playlist tracks
- **AND** create a job to track progress
- **IMPLEMENTED**: `SyncingStep` calls `startSync()` on mount with pending job

#### Scenario: Real-time per-phase counts displayed
- **WHEN** sync is in progress
- **THEN** emit SSE item events with `count` field for each phase
- **AND** update count in real-time as items are fetched/synced
- **IMPLEMENTED**: `orchestrator.ts` emits counts via progress callbacks

#### Scenario: Progress shown during sync
- **WHEN** sync is in progress
- **THEN** display overall progress percentage with smooth animation
- **AND** show real-time item counts: "X liked songs found", "Y playlists found"
- **IMPLEMENTED**: `SyncingStep` uses `getSmoothProgressPercent()` + `useAnimatedNumber()`

#### Scenario: Completion captures final stats
- **WHEN** sync completes all three phases
- **THEN** forward final count totals to the next step via `syncStats`
- **AND** capture: total songs synced, total playlists found
- **IMPLEMENTED**: `goToFlagPlaylists({ syncStats })` called on completion

---

### Requirement: Connecting Step Timing

The system SHALL show a brief "Linking to Spotify" transition before syncing.

#### Scenario: Brief branding moment
- **WHEN** OAuth callback completes and user lands on connecting step
- **THEN** display "Linking to Spotify" UI for 200ms
- **AND** auto-transition to syncing step
- **IMPLEMENTED**: `ConnectingStep` uses 200ms setTimeout (reduced from 1500ms)

---

### Requirement: Error Recovery

The system SHALL provide recovery options when sync fails.

#### Scenario: Sync failure recovery
- **WHEN** sync job status is "failed"
- **THEN** display error message: "Something went wrong"
- **AND** show "Start Over" button that hard-navigates to welcome step
- **IMPLEMENTED**: `SyncingStep` renders error state with `window.location.href` navigation

---

## DEFERRED Requirements

### Requirement: Ready Step Statistics

The Ready step SHALL display actual sync statistics instead of hardcoded values.

#### Scenario: Ready step shows real statistics
- **WHEN** user reaches final Ready step
- **THEN** display actual counts: total songs synced, total playlists found
- **AND** use values forwarded from sync phase (not hardcoded placeholders)
- **STATUS**: Deferred to separate change (syncStats forwarding implemented, display not yet)

---
