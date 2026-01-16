# Newness Tracking Specification

> Tracking "new" state for items to display badges and counts in the UI.

**Detailed design**: `docs/NEWNESS-TRACKING.md`

---

## Requirements

### Requirement: New Item Tracking

The system SHALL track when items become "new" to display badges.

#### Scenario: New songs synced
- **WHEN** new liked songs sync from Spotify
- **THEN** create `item_status` record with `is_new = true`

#### Scenario: New matches generated
- **WHEN** matching algorithm produces new results
- **THEN** create `item_status` record for each new match

#### Scenario: New playlists discovered
- **WHEN** new playlists sync from Spotify
- **THEN** create `item_status` record with `is_new = true`

---

### Requirement: Badge Counts

The system SHALL display counts of new items in navigation.

#### Scenario: Sort Songs badge
- **WHEN** rendering sidebar navigation
- **THEN** show badge with count of new songs ready to match

#### Scenario: Playlists badge
- **WHEN** rendering sidebar navigation
- **THEN** show badge with count of new playlists (optional)

#### Scenario: Efficient count query
- **WHEN** fetching badge counts
- **THEN** use single query: `SELECT item_type, COUNT(*) WHERE is_new = true GROUP BY item_type`

---

### Requirement: View-Based Clearing

The system SHALL clear "new" status when user views items.

#### Scenario: Viewport intersection
- **WHEN** item is visible in viewport for 2+ seconds
- **THEN** set `viewed_at` timestamp and clear `is_new`

#### Scenario: Batch clearing
- **WHEN** user scrolls through list
- **THEN** clear newness for all visible items in batch

#### Scenario: Debounced updates
- **WHEN** rapidly scrolling
- **THEN** debounce clearing calls to avoid excessive writes

---

### Requirement: Action-Based Clearing

The system SHALL clear "new" status when user takes action.

#### Scenario: Add to playlist
- **WHEN** user adds song to playlist
- **THEN** set `actioned_at`, `action_type = 'added_to_playlist'`, clear `is_new`

#### Scenario: Skip song
- **WHEN** user skips a song
- **THEN** set `actioned_at`, `action_type = 'skipped'`, clear `is_new`

#### Scenario: Dismiss notification
- **WHEN** user dismisses a new item notification
- **THEN** set `actioned_at`, `action_type = 'dismissed'`, clear `is_new`

---

### Requirement: Explicit Clearing

The system SHALL allow explicit "mark all as read" action.

#### Scenario: Mark all songs read
- **WHEN** user clicks "Mark all as read" on songs list
- **THEN** clear `is_new` for all songs of that type

#### Scenario: Confirmation optional
- **WHEN** count is high (>50)
- **THEN** optionally confirm before clearing

---

### Requirement: Age-Based Expiry

The system SHALL automatically expire old "new" items.

#### Scenario: Cron job expiry
- **WHEN** cron runs daily
- **THEN** clear `is_new` for items older than 7 days

#### Scenario: Configurable threshold
- **WHEN** setting expiry policy
- **THEN** use environment variable or app config

---

## Database Schema

```sql
CREATE TABLE item_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,  -- 'song', 'match', 'analysis', 'playlist'
  item_id UUID NOT NULL,
  is_new BOOLEAN DEFAULT true,
  first_appeared_at TIMESTAMPTZ DEFAULT now(),
  viewed_at TIMESTAMPTZ,
  actioned_at TIMESTAMPTZ,
  action_type TEXT,  -- 'added_to_playlist', 'skipped', 'dismissed'
  UNIQUE(account_id, item_type, item_id)
);

CREATE INDEX idx_item_status_new ON item_status(account_id, item_type)
  WHERE is_new = true;
```

---

## Query Module Functions

```typescript
// data/newness.ts

// Get counts for UI badges
export function getNewCounts(accountId: string): Promise<{
  songs: number
  matches: number
  playlists: number
}>

// Get IDs of new items (for highlighting)
export function getNewItemIds(
  accountId: string,
  itemType: ItemType
): Promise<string[]>

// Mark items as new (called by sync/analysis)
export function markItemsNew(
  accountId: string,
  itemType: ItemType,
  itemIds: string[]
): Promise<void>

// Clear newness (view-based)
export function markSeen(
  accountId: string,
  itemType: ItemType,
  itemIds: string[]
): Promise<void>

// Clear all newness (explicit action)
export function markAllSeen(
  accountId: string,
  itemType: ItemType
): Promise<void>
```

---

## Clearing Strategies Summary

| Strategy | Trigger | Sets |
|----------|---------|------|
| View-based | 2s in viewport | `viewed_at`, `is_new = false` |
| Action-based | User action | `actioned_at`, `action_type`, `is_new = false` |
| Explicit | "Mark all read" | `is_new = false` for all |
| Age-based | Cron job | `is_new = false` for items > 7 days |
