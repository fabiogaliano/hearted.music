# Job Progress Specification

> SSE real-time job event system for tracking sync operations.

**Status**: ✅ IMPLEMENTED

## Purpose

Provide low-latency, real-time progress updates for background job operations (sync, matching, etc.) via Server-Sent Events. Support phase tracking, item-level status, and numeric counts.

---

## ADDED Requirements

### Requirement: Item Count Tracking

The system SHALL support optional count fields in item status events to track per-phase progress (e.g., songs fetched, playlists synced).

#### Scenario: Count field in in_progress state
- **WHEN** a sync phase is actively fetching items
- **THEN** emit item event with `status: "in_progress"` and `count: <number fetched so far>`
- **AND** update count on each new batch without changing other fields
- **IMPLEMENTED**: `orchestrator.ts` emits counts via `emitItem()` during fetch loops

#### Scenario: Count field in final state
- **WHEN** a sync phase completes
- **THEN** emit item event with `status: "succeeded"` and `count: <final total for phase>`
- **AND** retain label and index for UI stability
- **IMPLEMENTED**: Final `emitItem()` calls include `count: result.value.total`

#### Scenario: Count is optional
- **WHEN** legacy code calls `emitItem()` without count
- **THEN** count field is absent in event (backwards compatible)
- **AND** UI displays stat as unavailable (fallback to 0 or omit display)
- **IMPLEMENTED**: All existing callers unchanged, count is optional in schema

---

### Requirement: Discovered Total Tracking (UI-side)

The UI SHALL track the maximum count seen per phase to enable smooth progress interpolation.

#### Scenario: Track discovered totals
- **WHEN** item events arrive with count values
- **THEN** maintain `itemTotals` map with max count per itemId
- **AND** use discovered total for sub-phase progress calculation
- **IMPLEMENTED**: `useJobProgress.ts` tracks `itemTotals: Map<string, number>`

#### Scenario: Smooth progress calculation
- **WHEN** calculating overall progress percentage
- **THEN** use weighted phase boundaries (liked_songs: 0-40%, playlists: 40-70%, playlist_tracks: 70-100%)
- **AND** interpolate within each phase as `phase_start + (current_count / discovered_total) * phase_range`
- **IMPLEMENTED**: `getSmoothProgressPercent()` in `useJobProgress.ts`

---

### Requirement: Animated Progress Display

The UI SHALL animate progress changes smoothly to prevent jarring jumps.

#### Scenario: Lerp-based animation
- **WHEN** raw progress percentage changes
- **THEN** animate displayed value using linear interpolation (lerp)
- **AND** never decrease (only increase towards target)
- **AND** maintain ~60fps animation loop via requestAnimationFrame
- **IMPLEMENTED**: `useAnimatedNumber()` hook in `SyncingStep.tsx`

---
