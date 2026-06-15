# Match Review Queue Refactor Plan

Date: 2026-06-15

## Goal

Make `/match` a durable, live-updating match queue instead of a client-local walk over the latest snapshot.

User-facing model: songs appear in a Tinder-like stack; users review them, add to one or more playlists, dismiss, or skip for now. New matches can arrive while the user is reviewing without interrupting the current card.

Backend model: immutable `match_snapshot` / `match_result` rows remain the matching source of truth. A new queue layer owns the user experience and stores which cards are being reviewed.

## Decisions already made

- New snapshot while matching: append eligible new songs to the queue tail; never change the current card.
- UI notification: small passive chip/toast such as `3 new matches added`; no refresh banner.
- Completion copy: treat this as `caught up`, not as a backend “session complete”.
- If refresh finishes after the user leaves/completes: sidebar/dashboard can update later.
- `Next Song`: skip for now; no negative decision is written, and the song can return in a future pass.
- Add behavior: a song can be added to multiple playlists while on the card; once the user moves on, that card is cleared for now.
- Avoid frontend terms like `snapshot` or `session`; those are backend concepts.

## Current hot paths

### Snapshot production

- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`
- `src/lib/workflows/match-snapshot-refresh/write-match-snapshot.ts`
- `supabase` RPC `publish_match_snapshot`
- Tables: `match_snapshot`, `match_result`
- Newness: `markItemsNew(accountId, "song", matchedSongIds)`

### Match page

- `src/routes/_authenticated/match.tsx`
- `src/features/matching/Matching.tsx`
- `src/features/matching/sections/MatchingSession.tsx`
- `src/features/matching/components/MatchesSection.tsx`
- `src/lib/server/matching.functions.ts`
  - `getMatchingSession`
  - `getSongMatches`
  - `addSongToPlaylist`
  - `dismissSong`
  - `markSeenSongs`

### Queue derivation

- `deriveUndecidedSongs`
- `getOrderedUndecidedSongIds`
- `getMatchResults`
- `getMatchDecisionsForSongs`
- `resolveMinMatchScore`
- entitlement RPCs:
  - `select_entitled_data_enriched_liked_song_ids`
  - `is_account_song_entitled`

### Invalidation / live refresh

- `src/lib/hooks/useActiveJobs.ts`
- `src/features/matching/queries.ts`
- `src/features/dashboard/queries.ts`

### Dashboard and sidebar

- `src/lib/server/dashboard.functions.ts`
- `src/features/dashboard/sections/MatchReviewCTA.tsx`
- `src/routes/_authenticated/route.tsx`
- Sidebar `unsortedCount`

## Architectural direction

Current boundary:

```txt
latest snapshot -> derived undecided song ids -> client-local displayedSession
```

Target boundary:

```txt
immutable snapshots -> durable match queue -> match card UI
```

Snapshots answer: what matches did the backend produce?

Queue items answer: what is this user reviewing now?

## Database design

### `match_review_session`

Internal name only. The UI should call this a queue/pass/caught-up state.

```sql
CREATE TABLE match_review_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  strictness_preset TEXT NOT NULL,
  strictness_min_score DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

Indexes / constraints:

```sql
CREATE UNIQUE INDEX idx_match_review_session_one_active
ON match_review_session(account_id)
WHERE status = 'active';

CREATE INDEX idx_match_review_session_account_created
ON match_review_session(account_id, created_at DESC);
```

### `match_review_queue_item`

```sql
CREATE TABLE match_review_queue_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES match_review_session(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  source_snapshot_id UUID NOT NULL REFERENCES match_snapshot(id),
  position INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'presented', 'completed', 'skipped', 'unavailable')),
  resolution TEXT CHECK (resolution IN ('added', 'dismissed', 'skipped', 'unavailable')),
  source_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  was_new_at_enqueue BOOLEAN NOT NULL DEFAULT false,
  presented_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Indexes / constraints:

```sql
CREATE UNIQUE INDEX idx_match_review_queue_item_session_position
ON match_review_queue_item(session_id, position);

CREATE UNIQUE INDEX idx_match_review_queue_item_session_song
ON match_review_queue_item(session_id, song_id);

CREATE UNIQUE INDEX idx_match_review_queue_item_session_snapshot_song
ON match_review_queue_item(session_id, source_snapshot_id, song_id);

CREATE INDEX idx_match_review_queue_item_session_state_position
ON match_review_queue_item(session_id, state, position);

CREATE INDEX idx_match_review_queue_item_account_state
ON match_review_queue_item(account_id, state);
```

### `match_review_session_snapshot`

Tracks which snapshots have already been applied to an active queue. Makes appending idempotent.

```sql
CREATE TABLE match_review_session_snapshot (
  session_id UUID NOT NULL REFERENCES match_review_session(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES match_snapshot(id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  appended_item_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, snapshot_id)
);
```

### `match_decision.queue_item_id`

Add optional queue linkage for analytics and replay.

```sql
ALTER TABLE match_decision
ADD COLUMN queue_item_id UUID REFERENCES match_review_queue_item(id);

CREATE INDEX idx_match_decision_queue_item
ON match_decision(queue_item_id)
WHERE queue_item_id IS NOT NULL;
```

## Domain module layout

Add:

```txt
src/lib/domains/taste/match-review-queue/
  types.ts
  queries.ts
  service.ts
```

Suggested responsibilities:

- `queries.ts`: DB reads/writes only, returning `Result<T, DbError>`.
- `service.ts`: queue orchestration and idempotent append logic.
- `types.ts`: queue row/domain types and discriminated unions.

Avoid catch-all utilities and barrel exports.

## Server function layout

Add:

```txt
src/lib/server/match-review-queue.functions.ts
```

Suggested functions:

```ts
startOrResumeMatchReview()
getMatchReview()
getMatchReviewItem({ itemId })
markMatchReviewItemPresented({ itemId })
addSongToPlaylistFromQueueItem({ itemId, playlistId })
dismissMatchReviewItem({ itemId })
finishMatchReviewItem({ itemId })
syncActiveMatchReviewSession()
```

Security rule: match page reads and mutations should take `queueItemId`, not client-supplied `snapshotId` + `songId`.

The server loads `song_id` and `source_snapshot_id` from the owned queue item, then reads `match_result` from that snapshot.

## Typed item read result

Replace null-shaped reads with an explicit discriminated union.

```ts
type MatchReviewItemRead =
  | {
      status: 'ready';
      itemId: string;
      song: MatchingSong;
      matches: MatchingPlaylistMatch[];
    }
  | {
      status: 'unavailable';
      itemId: string;
      reason:
        | 'not-entitled'
        | 'missing-song'
        | 'snapshot-not-owned'
        | 'no-visible-matches';
      message: string;
    }
  | {
      status: 'error';
      itemId: string;
      message: string;
    };
```

Completion/caught-up state must be derived from queue position/state, never from `song === null`.

## Queue derivation rules

When seeding or appending a snapshot:

1. Load snapshot match results.
2. Load account decisions for matched songs.
3. Apply the session's stored `strictness_min_score`.
4. Keep songs with at least one visible undecided match.
5. Filter to currently entitled songs.
6. Exclude songs already in the active session queue.
7. Sort with the existing ordering policy:
   - new songs first
   - max visible score descending
   - song id ascending
8. Append at `max(position) + 1`.
9. Insert `match_review_session_snapshot` so re-syncing the same snapshot is a no-op.

Important: store `source_score` as the max visible score at enqueue time so the queue order is explainable and stable.

## Strictness behavior

The existing setting is the Match strictness picker in `/settings`:

- `open` => `0.35`
- `balanced` => `0.5`
- `strict` => `0.65`

Recommendation:

- Store `strictness_preset` and `strictness_min_score` on `match_review_session` at creation.
- Use that stored score for all items in that queue/pass.
- If the user changes strictness later, apply it to the next queue/pass or to newly created queues.

This avoids cards disappearing mid-review. If we later want stricter live behavior, we can choose to apply changed settings only to future appended items.

## Decision semantics

### Add

`addSongToPlaylistFromQueueItem({ itemId, playlistId })`:

- Load queue item by `itemId` and account.
- Verify queue item is not resolved.
- Verify song entitlement.
- Verify playlist ownership.
- Resolve served context from `source_snapshot_id` and `song_id`.
- Upsert `match_decision` with:
  - `snapshot_id`
  - `served_rank`
  - `queue_item_id`
  - decision `added`
- Do not automatically advance the card; user may add to multiple playlists.

### Dismiss

`dismissMatchReviewItem({ itemId })`:

- Server derives visible playlist matches from the queue item's source snapshot.
- Writes dismissed decisions for visible undecided playlist pairs.
- Marks queue item `completed` with resolution `dismissed`.

### Next Song

`finishMatchReviewItem({ itemId })`:

- If this card had one or more successful adds, mark `completed` with resolution `added`.
- Otherwise mark `skipped` with resolution `skipped`.
- Do not write negative decisions for skip.
- Skipped items do not reappear in the same pass because `(session_id, song_id)` is unique.
- Skipped songs can return in a future pass/session.

## Newness behavior

Replace current unload-based `useMatchingSession` / `markSeenSongs` for the match page.

When an item is presented:

- mark queue item `presented`
- set `presented_at`
- mark `account_item_newness` false for that song

This makes newness durable and immediate instead of relying on unload cleanup.

## UI refactor

### Remove from `src/routes/_authenticated/match.tsx`

- `displayedSession`
- snapshot refresh banner
- `handleRefresh`
- `key={displayedSession.snapshotId}` remount semantics
- client-supplied `snapshotId`/`songId` read path
- null-song-as-completion fallback

### Add

- route loader calls `startOrResumeMatchReview`
- match page reads `getMatchReview`
- current card identified by queue item id
- per-card query uses `getMatchReviewItem({ itemId })`
- local offset remains only for smooth client navigation within loaded queue ids
- when queue query updates with appended items, preserve current offset/card
- total count updates softly
- passive chip/toast announces appended count

### Copy changes

Avoid:

- snapshot
- session
- refresh
- backend queue terminology

Prefer:

- `You're caught up`
- `New matches added`
- `No matches right now`
- `Check back after your next sync`

### Error/unavailable cards

If a queue item becomes unavailable:

- show an inline non-scary card state
- explain simply, e.g. `This song is no longer available to match.`
- primary action: `Next Song`
- server marks item unavailable/skipped when user advances

## Live update behavior

Update `useActiveJobs` on `matchSnapshotRefresh` completion:

1. call `syncActiveMatchReviewSession()`
2. invalidate queue summary/query
3. invalidate dashboard stats/previews
4. invalidate sidebar summary
5. do not invalidate per-card item queries

Polling is enough for v1. SSE can be added later if the UX needs sub-second updates.

## Dashboard/sidebar refactor

Introduce a queue-aware summary function, for example:

```ts
getMatchReviewSummary(): {
  pendingCount: number;
  previewImages: MatchPreview[];
  hasActiveQueue: boolean;
}
```

Use the same source for:

- dashboard CTA count
- dashboard preview fan spread
- sidebar badge
- match page empty/caught-up state

Fallback behavior:

- If active queue exists: count unresolved queue items.
- If no active queue exists: derive from latest snapshot and create queue on `/match` entry.
- If no queueable items: hide dashboard CTA and show caught-up/no-context empty state.

## Implementation phases

### Phase 0: keep the hotfix

Already committed as `fix(matching): keep frozen walk alive after snapshot refresh`.

Keep it until the queue refactor fully replaces the current route behavior.

### Phase 1: DB migration and generated types

- Add queue/session tables.
- Add decision queue item linkage.
- Add indexes/constraints.
- Regenerate Supabase types.
- Add migration tests if project convention supports them.

### Phase 2: queue domain module

- Add DB query functions.
- Add service functions for:
  - create active queue
  - resume active queue
  - append snapshot delta
  - summarize active queue
  - mark presented/resolved
- Unit test service derivation with mocks.

### Phase 3: item read path

- Implement `getMatchReviewItem`.
- Return discriminated union, not `null`.
- Keep entitlement checks at read time.
- Use session stored strictness.
- Test unavailable/error cases.

### Phase 4: queue-aware mutations

- Implement add/dismiss/finish by queue item id.
- Add `queue_item_id` to decision upserts.
- Preserve current served-rank/snapshot logging.
- Test multi-add before finishing.
- Test skip writes no decisions.

### Phase 5: match route rewrite

- Switch loader/query hooks to queue APIs.
- Remove banner refresh flow.
- Preserve current card across appended queue items.
- Add passive new-match chip/toast.
- Replace completion screen copy with caught-up copy.

### Phase 6: live append integration

- On background refresh completion, sync active queue.
- Narrow invalidation to queue summary/dashboard/sidebar.
- Avoid per-card invalidation.

### Phase 7: dashboard/sidebar migration

- Replace latest-snapshot-derived CTA count with queue-aware summary.
- Keep dashboard preview ordering consistent with queue order.
- Update tests.

### Phase 8: cleanup old APIs

After the new route is stable:

- remove or demote `getMatchingSession`
- remove old `getSongMatches` route usage
- remove `markSeenSongs` from match route
- remove `displayedSession` comments/tests
- update names in `features/matching/queries.ts`

## Test plan

### Domain/service tests

- creates a queue from latest snapshot
- creates only one active queue per account
- resumes existing active queue
- appends new snapshot delta idempotently
- excludes songs already in active queue
- excludes already-decided songs
- excludes non-entitled songs
- respects stored strictness threshold
- preserves deterministic ordering
- marks presented and clears newness
- marks skip without decisions
- marks add-completed after one or more adds

### Server function tests

- rejects foreign queue item
- rejects foreign playlist on add
- returns unavailable for revoked entitlement
- returns unavailable for missing snapshot/song
- add writes `snapshot_id`, `served_rank`, and `queue_item_id`
- dismiss writes surfaced negative decisions from server-derived visible matches
- finish after add clears card without dismissing remaining playlists
- skip writes no match decisions

### UI/query tests where feasible

- current card does not change when queue grows
- total count updates when queue grows
- passive chip appears when items append
- caught-up state is based on queue, not null song data
- unavailable card has a recoverable next action

### Dashboard/sidebar tests

- dashboard CTA uses queue pending count
- fan spread uses queue order
- sidebar badge updates after queue sync
- no CTA when caught up

## Rollback strategy

This refactor can be additive until route switch-over.

- Keep old snapshot-derived APIs while building the queue.
- Add queue tables without removing old columns/functions.
- Switch `/match` behind a single route-level implementation change.
- If needed, revert route to old APIs while leaving queue tables unused.

## Open product decisions

- Whether changed strictness should apply only to future queues or future appended items.
- Whether skipped songs should have a time-based cooldown before future passes.
- Whether a completed/caught-up queue should be automatically abandoned when a new snapshot arrives, or whether a new pass should be created lazily on `/match` entry.
- Whether live updates should stay polling-based or graduate to SSE later.
