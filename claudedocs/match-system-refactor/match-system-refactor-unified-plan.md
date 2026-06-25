# Unified Match System Refactor Plan

Date: 2026-06-25

## Executive summary

This is a full refactor, not a light patch.

We will make `/match` support both review orientations:

- **Song mode**: one song → playlist suggestions
- **Playlist mode**: one playlist → song suggestions

At the same time, we will fix the reranker model so ranks are suggestion-list-local and orientation-specific, and we will reduce wasted compute from match refreshes that become stale while running.

Core principles:

1. `fused_score` is the shared pair-level score.
2. Reranker ranks are orientation-specific, not universal.
3. Strictness and match percent use `fused_score`, not reranker score.
4. The rank logged for an action must match the suggestion list the user actually saw.
5. Match snapshots remain atomic; no partial mid-run config patching.
6. Rapid config saves should coalesce and stale jobs should stop before expensive stages.

---

## 1. Current problems

### 1.1 Reranker direction does not match current UI

Current pair data is shared:

```txt
(song_id, playlist_id, fused_score, factors, ...)
```

But reranking is list/query-contextual:

- song-orientation suggestion list: one song query → many playlist suggestions
- playlist-orientation suggestion list: one playlist query → many song suggestions

The current `/match` UI is song-oriented, while the existing reranker is playlist-oriented. Using playlist-oriented ranks to order or log a song-oriented suggestion list is incorrect.

### 1.2 `score` / `rank` are overloaded

`match_result.score` currently mixes pair-level scoring and post-rerank ordering. `match_result.rank` is treated as if it were universally meaningful, but it is only meaningful inside the suggestion list that produced it.

### 1.3 Strictness should not use reranker score

Reranker scores are query/list-dependent. A fixed threshold like “above 50%” should not be applied to raw reranker output.

Use `fused_score` for:

- strictness
- match percent
- hidden-count derivation
- cross-subject queue ordering

### 1.4 Refresh jobs waste compute after rapid saves

Playlist config saves can make a running refresh obsolete. Today the running job still completes, then a catch-up job runs.

That preserves consistency but wastes work and delays the latest change.

---

## 2. Desired product behavior

### 2.1 `/match` has a mode toggle

Add a small `Song | Playlist` toggle to the existing header row, top-right, beside the count.

```txt
Matching                         [Song] [Playlist]
1 / 5
────────────────────────────────────────────────
```

Requirements:

- no extra explanatory UI
- no new page or modal
- URL/search-param backed; the URL is the route source of truth
- canonical default mode: `song`
- canonical URLs:
  - `/match` → song mode
  - `/match?mode=playlist` → playlist mode
- `mode=song` is accepted but normalized away with `replace: true`
- invalid `mode` values are ignored and normalized to `/match` with `replace: true`
- toggling to Playlist pushes/replaces `?mode=playlist`; toggling to Song removes the param
- persist the user's last selected mode for dashboard/sidebar summaries and navigation links, but do not let preference state override an explicit URL on `/match`

### 2.2 Song mode keeps current layout

```txt
left:  song review item with album art + Spotify play overlay
right: playlist suggestion rows with playlist hover preview
```

This should remain visually equivalent to the current experience.

### 2.3 Playlist mode swaps review item/suggestions

```txt
left:  playlist review item
right: song suggestion rows
```

Requirements:

- playlist review item keeps hover/focus track preview
- song suggestions keep Spotify play affordance
- song suggestion list scrolls inline when long
- no new visual system beyond the toggle and swapped components

### 2.4 Active match pass progress is per orientation

A user can have:

- active song-mode match pass
- active playlist-mode match pass

Switching mode should not destroy the other mode’s progress.

---

## 3. Data model

### 3.1 Shared pair-level result stays in `match_result`

`match_result` remains the pair table:

```txt
snapshot_id
song_id
playlist_id
fused_score
score       -- legacy compatibility
rank        -- legacy compatibility
factors
normalized_factors
```

Transitional semantics:

- `fused_score`: authoritative strictness/fit score
- `score`: legacy compatibility ordering score
- `rank`: legacy compatibility rank
- new ranking table: authoritative model ordering

Do not delete `score` or `rank` in this refactor.

### 3.2 Add orientation-specific ranking table

```sql
CREATE TABLE match_result_ranking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL,
  song_id UUID NOT NULL,
  playlist_id UUID NOT NULL,
  orientation TEXT NOT NULL CHECK (orientation IN ('song', 'playlist')),

  rank INTEGER NOT NULL CHECK (rank > 0),
  ordering_score DOUBLE PRECISION NOT NULL,
  reranker_score DOUBLE PRECISION,

  source TEXT NOT NULL CHECK (source IN ('rerank', 'fused_fallback')),
  document_mode TEXT NOT NULL CHECK (document_mode IN ('analysis', 'metadata')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (snapshot_id, orientation, song_id, playlist_id),
  CONSTRAINT match_result_ranking_match_result_fk
    FOREIGN KEY (snapshot_id, song_id, playlist_id)
    REFERENCES match_result(snapshot_id, song_id, playlist_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_match_result_ranking_song_slate_rank_unique
  ON match_result_ranking(snapshot_id, song_id, orientation, rank)
  WHERE orientation = 'song';

CREATE UNIQUE INDEX idx_match_result_ranking_playlist_slate_rank_unique
  ON match_result_ranking(snapshot_id, playlist_id, orientation, rank)
  WHERE orientation = 'playlist';
```

The partial unique rank indexes enforce one row per dense rank in each served suggestion list and also serve the ordered suggestion-list read path. They are not just performance indexes; they prevent ambiguous model ordering.

### 3.3 Add orientation to match passes/items

`match_review_session`:

```sql
ALTER TABLE match_review_session
ADD COLUMN orientation TEXT NOT NULL DEFAULT 'song'
CHECK (orientation IN ('song', 'playlist'));

DROP INDEX IF EXISTS idx_match_review_session_one_active;

CREATE UNIQUE INDEX idx_match_review_session_one_active_per_orientation
  ON match_review_session(account_id, orientation)
  WHERE status = 'active';
```

Update session APIs to take orientation explicitly:

```ts
async function fetchActiveSession(
  accountId: string,
  orientation: MatchOrientation,
): Promise<Result<MatchReviewSession | null, DbError>>;

async function insertMatchReviewSession(input: {
  accountId: string;
  orientation: MatchOrientation;
  strictnessPreset: string;
  strictnessMinScore: number;
}): Promise<Result<MatchReviewSession, DbError>>;
```

`match_review_queue_item`:

```sql
ALTER TABLE match_review_queue_item
ADD COLUMN orientation TEXT NOT NULL DEFAULT 'song'
CHECK (orientation IN ('song', 'playlist')),
ADD COLUMN playlist_id UUID REFERENCES playlist(id) ON DELETE CASCADE,
ADD COLUMN visible_pairs_captured_at TIMESTAMPTZ;

-- Existing song_id becomes nullable if currently NOT NULL.
ALTER TABLE match_review_queue_item
ALTER COLUMN song_id DROP NOT NULL;

ALTER TABLE match_review_queue_item
RENAME COLUMN source_score TO source_fit_score;

ALTER TABLE match_review_queue_item
ADD CONSTRAINT match_review_queue_item_exactly_one_subject CHECK (
  (orientation = 'song' AND song_id IS NOT NULL AND playlist_id IS NULL) OR
  (orientation = 'playlist' AND playlist_id IS NOT NULL AND song_id IS NULL)
);
```

Replace the current song-only uniqueness with orientation-specific partial indexes:

```sql
DROP INDEX IF EXISTS idx_match_review_queue_item_session_song;
DROP INDEX IF EXISTS idx_match_review_queue_item_session_snapshot_song;

CREATE UNIQUE INDEX idx_match_review_queue_item_session_song_subject
  ON match_review_queue_item(session_id, song_id)
  WHERE orientation = 'song';

CREATE UNIQUE INDEX idx_match_review_queue_item_session_playlist_subject
  ON match_review_queue_item(session_id, playlist_id)
  WHERE orientation = 'playlist';

CREATE UNIQUE INDEX idx_match_review_queue_item_session_snapshot_song_subject
  ON match_review_queue_item(session_id, source_snapshot_id, song_id)
  WHERE orientation = 'song';

CREATE UNIQUE INDEX idx_match_review_queue_item_session_snapshot_playlist_subject
  ON match_review_queue_item(session_id, source_snapshot_id, playlist_id)
  WHERE orientation = 'playlist';
```

Do not keep the old `(session_id, song_id)` indexes after `song_id` becomes nullable; they do not protect playlist-mode rows because PostgreSQL unique indexes allow multiple `NULL` values.

Normalize queue item lifecycle naming so state and outcome are separate:

```sql
ALTER TABLE match_review_queue_item
DROP CONSTRAINT IF EXISTS match_review_queue_item_state_check,
ADD CONSTRAINT match_review_queue_item_state_check
CHECK (state IN ('pending', 'active', 'resolved'));

ALTER TABLE match_review_queue_item
DROP CONSTRAINT IF EXISTS match_review_queue_item_resolution_check,
ADD CONSTRAINT match_review_queue_item_resolution_check
CHECK (resolution IS NULL OR resolution IN ('added', 'dismissed', 'skipped', 'unavailable'));
```

State semantics:

- `pending`: the card has not captured its first visible suggestion list
- `active`: the card has captured its visible suggestion list and can still receive actions
- `resolved`: the card is terminal; inspect `resolution` for `added`, `dismissed`, `skipped`, or `unavailable`

`match_review_session_snapshot` idempotency must account for read-time filter changes:

```sql
ALTER TABLE match_review_session_snapshot
ADD COLUMN visibility_config_hash TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE match_review_session_snapshot
DROP CONSTRAINT match_review_session_snapshot_pkey;

ALTER TABLE match_review_session_snapshot
ADD PRIMARY KEY (session_id, snapshot_id, visibility_config_hash);
```

`visibility_config_hash` is the hash of the read-time visibility settings used when deriving queue subjects for that session append:

```ts
type QueueVisibilityConfigHashInput = {
  orientation: MatchOrientation;
  strictnessMinScore: number;
  readTimeFiltersHash: string;
};
```

Rules:

- before Phase 9, use a stable `readTimeFiltersHash = "write-time-filters"`
- after Phase 9, include all target playlist read-time hard filters in `readTimeFiltersHash`, stable-stringified in `playlistId asc` order
- reapplying the same snapshot with a new `visibility_config_hash` is allowed
- subject-level unique indexes prevent duplicate queue items when a loosened filter reveals only already-queued subjects
- filter-only saves call `syncActiveMatchReviewSessions` so active match passes can append subjects newly visible under the new hash

TypeScript domain model:

```ts
type QueueItemState = 'pending' | 'active' | 'resolved';
type QueueItemResolution = 'added' | 'dismissed' | 'skipped' | 'unavailable';

type MatchReviewSubject =
  | { orientation: 'song'; songId: string }
  | { orientation: 'playlist'; playlistId: string };

type MatchReviewQueueItemDto = {
  id: string;
  position: number;
  state: QueueItemState;
  resolution: QueueItemResolution | null;
  sourceSnapshotId: string;
  sourceFitScore: number;
  subject: MatchReviewSubject;
};

type MatchReviewSummaryPreview =
  | {
      orientation: 'song';
      id: string;
      imageUrl: string | null;
      name: string;
      subtitle: string; // artist
    }
  | {
      orientation: 'playlist';
      id: string;
      imageUrl: string | null;
      name: string;
      subtitle: string; // track count or intent fallback
    };

type MatchReviewSummaryResult = {
  orientation: MatchOrientation;
  remainingCount: number;
  previewItems: MatchReviewSummaryPreview[];
  hasActiveMatchPass: boolean;
};
```

Repository mappers may read nullable `song_id` / `playlist_id` from SQL, but exported domain/server types must use `MatchReviewSubject`; do not expose `{ songId?: string; playlistId?: string }`.

### 3.4 Match view preference

Persist the user's last selected match mode for non-`/match` surfaces.

```sql
ALTER TABLE user_preferences
ADD COLUMN match_view_mode TEXT NOT NULL DEFAULT 'song'
CHECK (match_view_mode IN ('song', 'playlist'));
```

Server helpers:

```ts
async function getPreferredMatchViewMode(
  accountId: string,
): Promise<MatchOrientation>;

async function setPreferredMatchViewMode(input: {
  accountId: string;
  mode: MatchOrientation;
}): Promise<Result<void, DbError>>;
```

Rules:

- `/match` URL remains authoritative: `/match` = song, `/match?mode=playlist` = playlist
- toggling modes updates `user_preferences.match_view_mode` best-effort after URL navigation is requested
- after a successful preference update, invalidate `preferredSummary(accountId)` and dashboard keys
- dashboard/sidebar summaries use `match_view_mode` to choose which orientation's summary to show
- dashboard/sidebar Match links point to `/match` for song preference and `/match?mode=playlist` for playlist preference

### 3.5 Presented suggestion-list capture

Visible ranks must come from the suggestion list captured when the card is presented, not from a later recomputation. A later recomputation can drift after an add because decided pairs are removed and the remaining rows would be re-densed.

Add a captured visible-pair table:

```sql
CREATE TABLE match_review_item_visible_pair (
  queue_item_id UUID NOT NULL REFERENCES match_review_queue_item(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES match_review_session(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES match_snapshot(id),
  orientation TEXT NOT NULL CHECK (orientation IN ('song', 'playlist')),

  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,

  model_rank INTEGER CHECK (model_rank > 0),
  visible_rank INTEGER NOT NULL CHECK (visible_rank > 0),
  fit_score DOUBLE PRECISION NOT NULL CHECK (fit_score >= 0 AND fit_score <= 1),

  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (queue_item_id, song_id, playlist_id),
  CONSTRAINT match_review_item_visible_pair_match_result_fk
    FOREIGN KEY (snapshot_id, song_id, playlist_id)
    REFERENCES match_result(snapshot_id, song_id, playlist_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_match_review_item_visible_pair_queue_visible_rank
  ON match_review_item_visible_pair(queue_item_id, visible_rank);

CREATE INDEX idx_match_review_item_visible_pair_account_queue
  ON match_review_item_visible_pair(account_id, queue_item_id, visible_rank);
```

Capture rules:

- capture only when an item becomes the active/current card, not during prefetch
- first capture wins; retries must return existing captured rows, not overwrite ranks
- mutations validate suggestions against captured rows
- add/dismiss/finish logging reads `model_rank`, `visible_rank`, and `orientation` from captured rows
- cards with no visible pairs may be marked active with zero captured rows and then resolved as skipped/unavailable without event rows

### 3.6 Event logging columns

Rename existing `match_event.served_rank` to `model_rank`, rename existing `match_event.display_rank` to `visible_rank`, and add served orientation context.

```sql
ALTER TABLE match_event
RENAME COLUMN served_rank TO model_rank;

ALTER TABLE match_event
RENAME COLUMN display_rank TO visible_rank;

ALTER TABLE match_event
ADD COLUMN served_orientation TEXT CHECK (served_orientation IN ('song', 'playlist'));
```

Add the same served context to `match_decision` for queue decisions; direct/non-queue decisions leave these nullable.

```sql
ALTER TABLE match_decision
RENAME COLUMN served_rank TO model_rank;

ALTER TABLE match_decision
ADD COLUMN served_orientation TEXT CHECK (served_orientation IN ('song', 'playlist')),
ADD COLUMN visible_rank INTEGER CHECK (visible_rank > 0);
```

Semantics:

- `served_orientation`: current UI mode
- `model_rank`: rank from `match_result_ranking`
- `visible_rank`: dense rank from `match_review_item_visible_pair`, captured when the card was presented

---

## 4. Ranking pipeline

### 4.1 Keep scoring/fusion unchanged; broaden pair retention for both orientations

`src/lib/domains/taste/song-matching/service.ts` continues to compute pair-level `fusedScore` over the candidate matrix.

Reranking does not decide whether a pair exists. It only orders suggestions inside oriented suggestion lists.

The persisted pair set must not remain song-top-K-only. Current code slices per song via `maxResultsPerSong`; that would starve playlist-mode suggestion lists because a playlist only sees songs where that playlist survived the song-oriented top-K.

After fusion and thresholding, retain the union of:

- top `MATCH_STORED_PAIRS_PER_SONG` playlists per song by `fusedScore desc, playlistId asc`
- top `MATCH_STORED_PAIRS_PER_PLAYLIST` songs per playlist by `fusedScore desc, songId asc`

Initial constants:

```ts
const MATCH_STORED_PAIRS_PER_SONG = DEFAULT_MATCHING_CONFIG.maxResultsPerSong;
const MATCH_STORED_PAIRS_PER_PLAYLIST =
  DEFAULT_MATCHING_CONFIG.maxResultsPerSong;
```

This changes retention, not scoring. `match_result` stores the union set. `match_result_ranking` ranks only rows in that stored union.

Add a pure retention helper near the matching service:

```ts
export function retainStoredMatchPairs(params: {
  thresholdedPairs: readonly MatchResult[];
  perSongLimit: number;
  perPlaylistLimit: number;
}): MatchResult[];
```

Rules:

- input pairs have `fusedScore` populated and already passed the write-time threshold
- include a pair if it is in either orientation's top-N set
- return each `(songId, playlistId)` at most once
- sort returned rows by `songId asc, fusedScore desc, playlistId asc` before grouping for publication
- assign provisional legacy song ranks by `fusedScore desc, playlistId asc`; orientation ranking later overwrites model ordering in `match_result_ranking`

Legacy compatibility:

- `match_result.score` mirrors the song-orientation `orderingScore` when available; otherwise it falls back to `fusedScore`.
- `match_result.rank` mirrors the song-orientation rank within the stored song suggestion list when available; otherwise it is `NULL`.
- New read paths must use `match_result_ranking`, not legacy `score`/`rank`.

### 4.2 Replace `rerankMatches` with orientation-aware ranking

Create:

```txt
src/lib/workflows/enrichment-pipeline/match-ranking.ts
```

Public shape:

```ts
export type MatchOrientation = 'song' | 'playlist';

export type RankingSource = 'rerank' | 'fused_fallback';
export type RankingDocumentMode = 'analysis' | 'metadata';

export interface RankedPair {
  orientation: MatchOrientation;
  songId: string;
  playlistId: string;
  rank: number;
  /** Exact score used to sort this suggestion list. */
  orderingScore: number;
  /** Raw provider/cross-encoder score. Null when no provider score exists. */
  rerankerScore: number | null;
  source: RankingSource;
  documentMode: RankingDocumentMode;
}

export interface RankedSuggestionLists {
  pairs: RankedPair[];
}

export async function rankMatchSuggestionLists(params: {
  orientations: readonly MatchOrientation[];
  matches: Map<string, MatchResult[]>;
  songs: MatchingSong[];
  playlists: PlaylistInfo[];
  rerankerService?: RerankerService;
  analysisText: Map<string, string>;
}): Promise<RankedSuggestionLists>;
```

Score semantics:

- `orderingScore` is the exact score used to sort the suggestion list.
- For reranked suggestions, `orderingScore` is the blended score returned as `candidate.score` by `RerankerService`.
- `rerankerScore` is the raw provider/cross-encoder score from `candidate.metadata.rerank_score`.
- `rerankerScore` is `null` for fused fallback rows or suggestions the service did not rerank.
- `source` is row-level: use `rerank` only for rows with a raw provider score; use `fused_fallback` for fallback rows, skipped rows, and non-reranked tail suggestions from a partial top-N rerank.
- `documentMode` is the document construction mode attempted for that suggestion list. Use `analysis` when the query or at least one suggestion document included analysis text; otherwise use `metadata`. If no rerank was attempted because no service was available, use `metadata`.

Reranker instructions are orientation-specific:

```ts
export const RERANK_INSTRUCTION_BY_ORIENTATION: Record<
  MatchOrientation,
  string
> = {
  song: "Given a song's mood, genre, and meaning, judge whether this playlist is a good destination for it.",
  playlist:
    "Given a playlist's mood and theme, judge if this song belongs in it.",
};
```

Update the reranker service so each call can override the task instruction without mutating shared service state:

```ts
async rerank(
  query: string,
  candidates: MatchCandidate[],
  options?: { instruction?: string },
): Promise<Result<RerankResult, RerankerServiceError>>;
```

`rankMatchSuggestionLists` must pass `RERANK_INSTRUCTION_BY_ORIENTATION[orientation]` for every suggestion list. These instruction strings must participate in `rankingConfigHash` / reranker config hashing.

Implement both:

- `rankSongSuggestionLists`
- `rankPlaylistSuggestionLists`

### 4.3 Song-oriented reranking

For each song:

```txt
query = song document
suggestions = playlist documents
base score = pair.fusedScore
instruction = RERANK_INSTRUCTION_BY_ORIENTATION.song
```

Document builders:

```ts
function buildSongRerankDocument(input: {
  song: MatchingSong;
  analysisText?: string;
}): { document: string; mode: RankingDocumentMode };

function buildPlaylistRerankDocument(input: { playlist: PlaylistInfo }): {
  document: string;
  mode: 'metadata';
};
```

Song document format matches the current reranker song document:

```txt
{name} by {artists}. Genres: {genres}.

{truncated analysis text when available}
```

Playlist document format uses the same intent text as playlist profiling:

```ts
buildIntentText(
  playlist.name,
  playlist.match_intent ?? undefined,
  playlist.genre_pills ?? [],
) ?? playlist.name;
```

Fallback order:

```txt
fusedScore desc, playlistId asc
```

Writes:

```txt
orientation = 'song'
```

### 4.4 Playlist-oriented reranking

For each playlist:

```txt
query = playlist intent/profile document
suggestions = song documents
base score = pair.fusedScore
instruction = RERANK_INSTRUCTION_BY_ORIENTATION.playlist
```

Use the same `buildPlaylistRerankDocument` for the query and `buildSongRerankDocument` for suggestions.

Fallback order:

```txt
fusedScore desc, songId asc
```

Writes:

```txt
orientation = 'playlist'
```

### 4.5 Cost guard

Computing both orientations may increase reranker spend.

Initial implementation can compute both because the toggle ships now:

```ts
const MATCH_RANKING_ORIENTATIONS: readonly MatchOrientation[] = [
  'song',
  'playlist',
];
```

If cost is too high, make playlist ranking adaptive later:

- always compute song orientation
- compute playlist orientation only after account uses playlist mode
- or gate playlist ranking behind config/feature flag

---

## 5. Publishing

Update `writeMatchSnapshot` / `publish_match_snapshot` to insert ranking rows atomically with match results.

### 5.1 Snapshot hash invalidation

The ranking refactor must force a new immutable snapshot even when candidates/playlists/config are otherwise unchanged. Existing latest snapshots have no `match_result_ranking` rows, and the current publish RPC no-ops solely on latest `snapshot_hash`.

Add `hashRankingConfig` to `src/lib/domains/enrichment/embeddings/hashing.ts` using prefix `rk_`. Add a ranking config hash to `computeMatchSnapshotMetadata` and include it in `hashMatchSnapshot`:

```ts
const MATCH_RANKING_SCHEMA_VERSION = 'oriented-suggestion-lists-v1';

const rankingConfigHash = await hashRankingConfig({
  schemaVersion: MATCH_RANKING_SCHEMA_VERSION,
  orientations: MATCH_RANKING_ORIENTATIONS,
  storedPairsPerSong: MATCH_STORED_PAIRS_PER_SONG,
  storedPairsPerPlaylist: MATCH_STORED_PAIRS_PER_PLAYLIST,
  rerankInstructions: RERANK_INSTRUCTION_BY_ORIENTATION,
});
```

`rankingConfigHash` must participate in `snapshotHash`. Bumping `MATCHING_ALGO_VERSION` alone is not sufficient unless it also changes the hashed metadata, because `publish_match_snapshot` dedupes by `snapshot_hash`, not by `algorithm_version`.

### 5.2 Atomic ranking publication

Preferred no-signature-change path: nested `rankings` in each `p_results` item.

```json
{
  "song_id": "...",
  "playlist_id": "...",
  "score": 0.74,
  "fused_score": 0.68,
  "rank": 2,
  "factors": {},
  "normalized_factors": {},
  "rankings": [
    {
      "orientation": "song",
      "rank": 1,
      "ordering_score": 0.81,
      "reranker_score": 0.92,
      "source": "rerank",
      "document_mode": "analysis"
    },
    {
      "orientation": "playlist",
      "rank": 4,
      "ordering_score": 0.74,
      "reranker_score": 0.79,
      "source": "rerank",
      "document_mode": "analysis"
    }
  ]
}
```

Older callers without `rankings` must continue to publish successfully.

---

## 6. Read paths

### 6.1 Shared strictness helper

```ts
export function strictnessScore(row: {
  fused_score: number | null;
  score: number;
}): number {
  return row.fused_score ?? row.score;
}
```

Use for gating and match percent.

### 6.2 Shared visible-suggestion-list helper and capture contract

Create `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts` as the single domain/server helper that derives the suggestion list before presentation capture:

```ts
type VisibleSuggestionList = {
  orientation: MatchOrientation;
  subject: MatchReviewSubject;
  items: Array<{
    songId: string;
    playlistId: string;
    fitScore: number;
    modelRank: number | null;
    visibleRank: number;
  }>;
};
```

Derivation rules:

1. fetch pair rows for the subject
2. apply orientation-specific ownership/entitlement checks
3. filter by `strictnessScore(row)`
4. apply read-time hard filters for the pair's playlist when those filters have moved out of write-time exclusions
5. remove decided pairs
6. join orientation-specific rankings
7. sort by ranking rank when present
8. fallback by `strictnessScore(row) desc`, stable id asc
9. assign dense `visibleRank`

Ownership/entitlement checks:

- song orientation: review item song must still be entitled; suggestion playlists must still belong to the account
- playlist orientation: review item playlist must still belong to the account; suggestion songs must still be entitled

Read-time filter application:

- song orientation: evaluate each suggestion playlist's filters against the review item song metadata
- playlist orientation: evaluate the review item playlist's filters against each suggestion song metadata
- use the existing predicate semantics: AND across filter types, OR within languages, missing metadata fails an active filter
- compute `nowMs` once per helper call for liked-date predicates

Presentation rules:

- `getMatchReviewItem` remains side-effect-free and may be used only for non-authoritative prefetch/static warming.
- The active card is loaded through `presentMatchReviewItem(itemId)`, which derives `VisibleSuggestionList`, calls `capture_match_review_item_visible_pairs_atomic`, marks the item active, and returns the captured rows joined to review item/suggestion render data.
- Presentation side effects are orientation-specific: song-mode presentation keeps the current song `account_item_newness` clear; playlist-mode presentation does not clear newness in this refactor.
- If captured rows already exist for the item, `presentMatchReviewItem` returns those rows instead of recomputing. This keeps ranks stable across retries, multi-add flows, and multi-tab races.
- Authoritative card rendering must use the `presentMatchReviewItem` result. Do not render a prefetched `getMatchReviewItem` result after visible-rank capture ships, because prefetch can precede the actual presentation.

Capture RPC:

```sql
CREATE OR REPLACE FUNCTION capture_match_review_item_visible_pairs_atomic(
  p_item_id UUID,
  p_account_id UUID,
  p_pairs JSONB
) RETURNS JSONB;
```

Input/return shape:

```ts
type CaptureVisiblePairInput = {
  song_id: string;
  playlist_id: string;
  model_rank: number | null;
  visible_rank: number;
  fit_score: number;
};

type CapturedVisiblePairRow = {
  queue_item_id: string;
  session_id: string;
  account_id: string;
  snapshot_id: string;
  orientation: MatchOrientation;
  song_id: string;
  playlist_id: string;
  model_rank: number | null;
  visible_rank: number;
  fit_score: number;
  captured_at: string;
};

type CaptureVisiblePairsResult =
  | { status: 'captured'; pairs: CapturedVisiblePairRow[] }
  | { status: 'already_captured'; pairs: CapturedVisiblePairRow[] }
  | { status: 'empty'; pairs: [] }
  | { status: 'not_found'; pairs: [] }
  | { status: 'already_resolved'; pairs: [] }
  | { status: 'invalid_input'; pairs: [] };
```

Contract:

- lock the owned queue item with `FOR UPDATE`
- return `not_found` for a missing or foreign item
- return `already_resolved` when the item state is `resolved`
- if `match_review_queue_item.visible_pairs_captured_at IS NOT NULL`, return `already_captured` with rows ordered by `visible_rank` and ignore `p_pairs` (rows may be empty)
- when `p_pairs` is an empty array, set `visible_pairs_captured_at`, mark the item `active`, and return `empty`
- otherwise insert `p_pairs` into `match_review_item_visible_pair`, scoped to the locked item/session/account/snapshot/orientation
- reject malformed JSON with `invalid_input` and no insert
- reject non-dense or duplicate visible ranks; valid non-empty input must have ranks exactly `1..p_pairs.length`
- reject rows whose orientation/snapshot/account/session do not match the locked queue item or whose pair does not match the queue subject
- set `visible_pairs_captured_at` and mark the item `active` in the same transaction when it is still `pending` or `active`
- return captured rows ordered by `visible_rank`

Authority split:

- `VisibleSuggestionList` derivation is the single authority for first presentation capture.
- `match_review_item_visible_pair` is the single authority for add mutation validation, dismiss derivation, skip/finish event logging, and visible-rank fields after capture.
- liked-song suggestions can use the helper directly because they are not queue presentation events.

### 6.3 Queue/match-pass server contracts

Route search contract:

```ts
type MatchSearch = { mode?: 'playlist' };

function validateMatchSearch(search: Record<string, unknown>): MatchSearch {
  return search.mode === 'playlist' ? { mode: 'playlist' } : {};
}

function modeFromSearch(search: MatchSearch): MatchOrientation {
  return search.mode === 'playlist' ? 'playlist' : 'song';
}
```

Add a `beforeLoad` normalization similar to existing search-param cleanup routes:

```ts
function hasNonCanonicalMatchMode(searchStr: string): boolean {
  const raw = new URLSearchParams(searchStr).get('mode');
  return raw !== null && raw !== 'playlist';
}
```

When non-canonical, redirect with `replace: true` to `/match` and empty search.

The route loader must use `loaderDeps` to pass `modeFromSearch(search)` into queue bootstrap and prefetches.

Every queue boundary takes orientation explicitly.

```ts
const MatchOrientationSchema = z.enum(['song', 'playlist']);

type MatchReviewStartInput = { orientation: MatchOrientation };
type MatchReviewReadInput = { orientation: MatchOrientation };
type MatchReviewSummaryInput = { orientation: MatchOrientation };

export const startOrResumeMatchReview: ServerFn<
  MatchReviewStartInput,
  MatchReviewStartResult
>;

export const getMatchReview: ServerFn<
  MatchReviewReadInput,
  MatchReviewResult | null
>;

export const presentMatchReviewItem: ServerFn<
  { itemId: string },
  MatchReviewItemRead
>;

export const getMatchReviewSummary: ServerFn<
  MatchReviewSummaryInput,
  MatchReviewSummaryResult
>;

export const getPreferredMatchReviewSummary: ServerFn<
  undefined,
  MatchReviewSummaryResult
>;

export const syncActiveMatchReviewSessions: ServerFn<
  undefined,
  { results: Array<{ orientation: MatchOrientation; appendedCount: number }> }
>;
```

`getPreferredMatchReviewSummary` reads `user_preferences.match_view_mode` and delegates to `getMatchReviewSummary({ orientation })`; dashboard/sidebar use this helper.

`syncActiveMatchReviewSessions` syncs every active orientation session for the account. It replaces the current single-orientation `syncActiveMatchReviewSession` live-update path.

React Query keys must include orientation anywhere the result is orientation-scoped:

```ts
reviewsRoot: ["match-review", "review"] as const,
review: (accountId: string, orientation: MatchOrientation) =>
  ["match-review", "review", accountId, orientation] as const,
summariesRoot: ["match-review", "summary"] as const,
summary: (accountId: string, orientation: MatchOrientation) =>
  ["match-review", "summary", accountId, orientation] as const,
preferredSummary: (accountId: string) =>
  ["match-review", "summary", accountId, "preferred"] as const,
item: (itemId: string) => ["match-review", "item", itemId] as const,
```

Item reads remain keyed by item id because item ids are globally unique and the item row carries orientation.

After a background match refresh completes, `useActiveJobs` must:

- await `syncActiveMatchReviewSessions()`
- invalidate `reviewsRoot` and `summariesRoot`
- continue not invalidating item queries; captured card data stays stable
- invalidate dashboard keys as today

### 6.4 Queue ordering

Create one orientation-aware queue derivation helper:

```ts
async function getOrderedUndecidedSubjects(input: {
  snapshotId: string;
  accountId: string;
  orientation: MatchOrientation;
  visibilityConfigHash: string;
}): Promise<{
  subjects: Array<{ subject: MatchReviewSubject; maxFitScore: number; wasNew: boolean }>;
  hiddenReviewItemCount: number;
}>;
```

The existing `getOrderedUndecidedSongIds` can remain temporarily as a song-mode wrapper for callers not yet migrated.

Queue ordering is cross-subject and uses `strictnessScore(row)`, not reranker score.

Song mode preserves current newness priority:

```txt
wasNewAtEnqueue desc,
max visible strictnessScore(row) desc,
songId asc
```

Playlist mode has no playlist-newness signal in this refactor, so subjects sort by:

```txt
max visible strictnessScore(row) desc,
playlistId asc
```

Set `was_new_at_enqueue = false` for playlist-mode queue items unless a future playlist-newness source is explicitly introduced.

Inside a card, suggestion ordering uses orientation-specific ranking.

---

## 7. UI/component plan

### 7.1 Types

Use discriminated unions.

```ts
type MatchViewMode = 'song' | 'playlist';

interface PlaylistForMatching {
  id: string;
  spotifyId: string;
  name: string;
  description: string | null;
  trackCount: number | null;
  imageUrl: string | null;
}

type MatchingReviewItem =
  | { mode: 'song'; song: SongForMatching }
  | { mode: 'playlist'; playlist: PlaylistForMatching };

type MatchingSuggestion =
  | { mode: 'song'; playlist: Playlist }
  | { mode: 'playlist'; song: SongForMatching; fitScore: number };

type MatchReviewItemRead =
  | {
      status: 'ready';
      itemId: string;
      mode: MatchViewMode;
      reviewItem: MatchingReviewItem;
      suggestions: MatchingSuggestion[];
    }
  | {
      status: 'unavailable';
      itemId: string;
      mode: MatchViewMode;
      reason:
        | 'not-entitled'
        | 'missing-review-item'
        | 'snapshot-not-owned'
        | 'no-visible-suggestions';
      message: string;
    }
  | {
      status: 'retryable-error';
      itemId: string;
      mode: MatchViewMode;
      reason: 'filter-metadata-unavailable' | 'load-failed';
      message: string;
    };

type ReviewedItem =
  | {
      mode: 'song';
      id: string;
      imageUrl: string | null;
      name: string;
      subtitle: string; // artist
    }
  | {
      mode: 'playlist';
      id: string;
      imageUrl: string | null;
      name: string;
      subtitle: string; // track count or intent fallback
    };

interface CompletionStats {
  totalItems: number;
  itemsMatched: number;
  totalAdditions: number;
  dismissedCount: number;
  skippedCount: number;
}
```

Top-level component props:

```ts
interface MatchingProps {
  mode: MatchViewMode;
  currentReviewItem: MatchingReviewItem | null;
  currentSuggestions: MatchingSuggestion[];
  totalItems: number;
  offset: number;
  addedTo: string[]; // suggestion ids added on the current card
  isComplete: boolean;
  completionStats: CompletionStats;
  recentItems: ReviewedItem[];
  reconnectNeeded?: boolean;
  navigationDisabled?: boolean;
  modeChangeDisabled: boolean;
  onModeChange: (mode: MatchViewMode) => void;
  onAdd: (suggestionId: string) => void;
  onDismiss: () => void | Promise<void>;
  onNext: () => void;
  onPrevious?: () => void;
  onExit: () => void;
}
```

No `any`; no loose optional state for mode-specific data.

Copy rules:

- song-mode skip CTA: `Skip Song`
- playlist-mode skip CTA: `Skip Playlist`
- dismiss CTA remains `Reject Match` / `Reject Matches` based on visible suggestion count
- final CTA remains `Finish matching`
- completion recap title is `Matched this round`
- completion thumbnails show `ReviewedItem` rows: songs in song mode, playlists in playlist mode
- hidden-count empty-state copy uses review-item nouns: `song(s)` in song mode, `playlist(s)` in playlist mode

### 7.2 Header

```ts
interface MatchingHeaderProps {
  currentIndex: number;
  totalItems: number;
  mode: MatchViewMode;
  modeChangeDisabled: boolean;
  onModeChange: (mode: MatchViewMode) => void;
}
```

Toggle behavior:

- render two real `<button type="button">` controls labelled `Song` and `Playlist`
- wrap them in a compact segmented container beside the count
- selected button has `aria-pressed="true"`; unselected has `aria-pressed="false"`
- Tab reaches each button in DOM order; Enter/Space activates the focused button
- activating the current mode is a no-op
- focus remains on the clicked/keyboard-activated button after navigation
- both buttons are disabled while a card add/dismiss/finish/previous/next action is pending
- disabled visual treatment: keep the selected/unselected styling but add reduced opacity (`opacity-50`) and `cursor-not-allowed`; native `disabled` blocks activation
- empty states do not disable either mode; they are handled by the mode's queue content
- visual treatment: selected uses `theme-primary` text and subtle `theme-surface-bg`; unselected uses muted text and transparent background, matching existing low-chrome header styling

### 7.3 Layout

Refactor `MatchingSession` into orientation-aware composition.

Mode switch behavior:

- changing mode updates the URL and remounts the mode-scoped `QueueMatchContent` by `mode`
- local visit-only state (`currentItemId`, `addedTo`, completion stats, recent reviewed items, pending locks) resets on mode switch
- server queue/match pass progress is preserved per orientation and reloaded through the orientation-keyed query
- Back/Forward restores the URL mode and reloads that mode's server progress

Song mode:

- existing `SongSection`
- existing `MatchesSection`

Playlist mode:

- `PlaylistReviewItemSection`
- `SongSuggestionsSection`

Do not use barrel exports.

### 7.4 Playlist review item

Reuse existing playlist cover/preview infrastructure.

- cover/name/intent in review item column
- use `Cover` for artwork, with the same placeholder behavior as playlist rows
- hover/focus opens track preview through `usePlaylistTrackPreview`
- the preview trigger wraps cover/name/intent as one bridged hover/focus region
- keyboard behavior matches current playlist row preview: Tab focuses the trigger, focus opens the preview, Escape closes it
- no additional UI chrome

### 7.5 Empty/unavailable states

`MatchingEmptyState` becomes orientation-aware:

```ts
interface MatchingEmptyStateProps {
  mode: MatchViewMode;
  reason:
    | 'no-context'
    | 'caught-up'
    | 'none-yet'
    | 'no-matches'
    | 'all-decided'
    | 'filtered';
  hiddenCount?: number;
}
```

Copy changes:

- `filtered` body uses `song(s)` in song mode and `playlist(s)` in playlist mode
- no-context/caught-up/none-yet keep the existing visual layout and CTA
- unavailable card copy uses the review-item noun:
  - song mode: `This song is no longer available to match.`
  - playlist mode: `This playlist is no longer available to match.`
- unavailable skip CTA uses `Skip Song` / `Skip Playlist` and resolves the item
- retryable card errors render an inline card with message `Couldn’t load this match card. Try again.` and a `Try again` button that refetches the item query
- retryable card errors do not call finish/skip and do not resolve the queue item

### 7.6 Song suggestion rows

Song suggestions should be compact and scrollable.

- reuse the existing match-row rhythm: match percent on the left, media/title in the middle, action on the right
- album art thumbnail with the same Spotify play overlay behavior as `SongSection`, scaled to row size
- song name / artist
- match percent from `strictnessScore(row)`
- trailing Add action adds suggestion song to the review item playlist
- only the suggestion list scrolls: `overflow-y-auto overscroll-contain` on the list container
- controls (`Reject`, `Previous`, `Skip Playlist`/`Finish matching`) stay pinned outside the scroll container
- keyboard order per row: play/preview control, Add button; disabled Add follows the existing disabled button treatment
- when all captured suggestions are added, rows remain visible and show the existing `Added` state; visible ranks do not re-dense

---

## 8. Mutations and event logging

### 8.1 Song mode add

```txt
review item song + suggestion playlist → add review item song to suggestion playlist
```

### 8.2 Playlist mode add

```txt
review item playlist + suggestion song → add suggestion song to review item playlist
```

Server should derive the review item from the queue item and validate the suggestion against the captured `match_review_item_visible_pair` rows for that queue item.

Public server function input:

```ts
const AddFromQueueSchema = z.object({
  itemId: z.uuid(),
  suggestionId: z.uuid(),
});

type AddFromQueueResult =
  | { success: true }
  | {
      success: false;
      reason:
        | 'not-found'
        | 'already-resolved'
        | 'invalid-target'
        | 'not-visible'
        | 'not-entitled'
        | 'foreign-playlist';
    };
```

The server reads the queue item orientation and calls the DB RPC with exactly one of `p_suggestion_song_id` or `p_suggestion_playlist_id`.

Atomic add RPC:

```sql
CREATE OR REPLACE FUNCTION add_match_review_item_decision_atomic(
  p_item_id UUID,
  p_account_id UUID,
  p_suggestion_song_id UUID DEFAULT NULL,
  p_suggestion_playlist_id UUID DEFAULT NULL
) RETURNS TEXT;
```

Return statuses:

```ts
type AddQueueItemDecisionAtomicStatus =
  | 'added'
  | 'not_found'
  | 'already_resolved'
  | 'invalid_target'
  | 'not_visible'
  | 'not_entitled'
  | 'foreign_playlist';
```

Contract:

- lock the owned unresolved queue item with `FOR UPDATE`
- for `orientation = 'song'`, require `p_suggestion_playlist_id` and use the item `song_id`
- for `orientation = 'playlist'`, require `p_suggestion_song_id` and use the item `playlist_id`
- return `invalid_target` when the provided suggestion id does not match the item orientation or both suggestion ids are provided
- require a matching `match_review_item_visible_pair` row for the target `(song_id, playlist_id)`
- reject with `not_visible` when the pair was not captured for this card
- verify the playlist belongs to the account and the song is still entitled before writing
- insert/update `match_decision` as `added`
- append `match_event` as `added`
- populate `served_orientation`, `model_rank`, and `visible_rank` from the captured row

### 8.3 Dismiss

- song mode: dismiss captured visible playlist pairs for review item song
- playlist mode: dismiss captured visible song pairs for review item playlist
- if no captured rows exist yet, derive and capture the suggestion list before dismissing; if derivation yields zero rows, return `derive-failed` and do not resolve

Atomic dismiss RPC:

```sql
CREATE OR REPLACE FUNCTION dismiss_match_review_item_atomic(
  p_item_id UUID,
  p_account_id UUID
) RETURNS TEXT;
```

Return statuses:

```ts
type DismissQueueItemAtomicStatus =
  | 'dismissed'
  | 'not_found'
  | 'already_resolved'
  | 'not_captured';

type DismissQueueResult =
  | { success: true }
  | {
      success: false;
      reason:
        | 'not-found'
        | 'already-resolved'
        | 'not-captured'
        | 'derive-failed'
        | 'decision-write-failed';
    };
```

Contract:

- lock the owned unresolved queue item with `FOR UPDATE`
- return `not_captured` when `visible_pairs_captured_at IS NULL`
- read captured rows for `p_item_id` (may be empty only for an empty captured suggestion list)
- resolve the item with state `resolved` and resolution `dismissed`
- insert dismissed `match_decision` rows for captured pairs that do not already have an added decision for the same queue item
- append dismissed `match_event` rows for the same pairs
- populate `served_orientation`, `model_rank`, and `visible_rank` from captured rows

### 8.4 Skip / finish

- log skipped events for captured visible pairs that do not already have an add decision for this queue item
- do not write `match_decision` for skipped pairs
- resolve/advance queue item
- if no captured rows exist yet, derive and capture the suggestion list before finish; if derivation yields zero rows, resolve the item as unavailable/skipped without event rows

Atomic finish RPC:

```sql
CREATE OR REPLACE FUNCTION finish_match_review_item_atomic(
  p_item_id UUID,
  p_account_id UUID
) RETURNS TEXT;
```

Return statuses:

```ts
type FinishQueueItemAtomicStatus =
  | 'completed_added'
  | 'skipped'
  | 'not_found'
  | 'already_resolved';
```

Contract:

- lock the owned unresolved queue item with `FOR UPDATE`
- read captured rows for `p_item_id`; if `visible_pairs_captured_at IS NULL`, treat the captured set as empty and write no events
- if captured rows exist, append skipped `match_event` rows for captured pairs without an added decision for the same queue item
- if the captured set is empty, write no events
- if one or more added decisions exist for the queue item, resolve with resolution `added` and return `completed_added`; otherwise resolve with resolution `skipped`
- populate `served_orientation`, `model_rank`, and `visible_rank` from captured rows

All queue actions write these fields from `match_review_item_visible_pair`:

```txt
served_orientation
model_rank
visible_rank
```

---

## 9. Refresh coalescing and cost reduction

This section integrates the refresh-cost plan. It should be implemented alongside or immediately after the ranking refactor because ranking both orientations can increase reranker spend.

### 9.1 Constraint: no mid-run config patching

Do not update filters/profile config inside a running job.

The matcher normalizes over the whole candidate matrix. A partial old/new run would produce incoherent scores. Whole-snapshot recomputation and atomic publish remain the correct unit.

### 9.2 Layer 1 — delayed job availability for config saves

Add a small coalescing window for playlist editor saves.

Schema:

```sql
ALTER TABLE job
ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP INDEX IF EXISTS idx_job_library_processing_poll;

CREATE INDEX idx_job_library_processing_poll
  ON job(queue_priority DESC NULLS LAST, created_at ASC)
  WHERE type IN ('enrichment', 'match_snapshot_refresh')
    AND status = 'pending';

CREATE INDEX idx_job_library_processing_available_at
  ON job(available_at ASC)
  WHERE type IN ('enrichment', 'match_snapshot_refresh')
    AND status = 'pending';
```

Update claim RPC:

```sql
WHERE type IN ('enrichment', 'match_snapshot_refresh')
  AND status = 'pending'
  AND available_at <= now()
```

Suggested delay:

```ts
const MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE = {
  playlist_management_session_flushed_recompute: 8_000,
  library_synced_target_metadata: 8_000,
  onboarding_target_selection_confirmed: 0,
  liked_songs_added_or_removed: 0,
  songs_unlocked: 0,
  enrichment_completed: 0,
};
```

Filter-only playlist saves do not enqueue match refresh after Phase 9; they invalidate read-time match review queries instead.

Scheduler computes the delay from the change kind and passes an absolute timestamp into ensure:

```ts
function resolveMatchRefreshAvailableAt(input: {
  changeKind: LibraryProcessingChange['kind'];
  now: Date;
}): string;

async function ensureMatchSnapshotRefreshJob(opts: {
  accountId: string;
  satisfiesRequestedAt: string;
  queuePriority: number;
  needsTargetSongEnrichment: boolean;
  availableAt: string;
}): Promise<Result<Job, DbError>>;
```

Change `ensureMatchSnapshotRefreshJob`:

- running existing job → return unchanged
- pending existing job → update:
  - `satisfies_requested_at = greatest(existing.satisfies_requested_at, opts.satisfiesRequestedAt)` with null treated as older
  - `queue_priority = opts.queuePriority`
  - `available_at = opts.availableAt`
  - `progress.plan.needsTargetSongEnrichment = existing || opts.needsTargetSongEnrichment`
- no job → insert with `available_at = opts.availableAt`

### 9.3 Layer 2 — cooperative superseded-job cancellation

A running job should check whether its `satisfies_requested_at` is older than current `requestedAt`.

Checkpoints:

1. after playlist profiling
2. after candidate loading
3. after exclusion/filter loading
4. before embedding load
5. before `matchBatch`
6. before orientation ranking/reranker
7. inside ranking between suggestion lists
8. before publish

Add helper:

```ts
async function isMatchRefreshJobSuperseded(input: {
  accountId: string;
  jobId: string;
  satisfiesRequestedAt: string;
}): Promise<boolean>;
```

Predicate:

```ts
return (
  state.matchSnapshotRefresh.activeJobId !== input.jobId ||
  (state.matchSnapshotRefresh.requestedAt !== null &&
    state.matchSnapshotRefresh.requestedAt > input.satisfiesRequestedAt)
);
```

Use ISO timestamp string comparison, matching existing marker ordering. If `job.satisfies_requested_at` is `null`, skip cooperative cancellation for that legacy job rather than guessing at its staleness.

Add non-error job outcome:

```ts
type MatchSnapshotRefreshExecuteResult =
  | {
      status: 'published';
      accountId: string;
      jobId: string;
      published: boolean;
      isEmpty: boolean;
    }
  | { status: 'superseded'; accountId: string; jobId: string };
```

Add change constructor:

```ts
const MatchSnapshotChanges = {
  superseded(opts: {
    accountId: string;
    jobId: string;
  }): Extract<LibraryProcessingChange, { kind: 'match_snapshot_superseded' }> {
    return { kind: 'match_snapshot_superseded', ...opts };
  },
};
```

Add reconciler change:

```ts
{
  kind: 'match_snapshot_superseded';
  accountId: string;
  jobId: string;
}
```

Runner behavior:

- `executeMatchSnapshotRefreshJob` returns `status: "superseded"` without throwing
- mark the job `completed`, not `failed`
- write `job_execution_measurement.outcome = "superseded"`
- apply `MatchSnapshotChanges.superseded`
- do not capture Sentry/error reporting for superseded exits

Reconciler behavior:

- clear `matchSnapshotRefresh.activeJobId` when it matches the superseded job id
- do not advance `matchSnapshotRefresh.settledAt`
- do not classify superseded as a failure change
- because `requestedAt > settledAt` remains true and active job is clear, emit a fresh `ensure_match_snapshot_refresh_job` effect
- do not publish anything from a superseded job

Terminal recovery behavior:

- if a completed `match_snapshot_refresh` job's latest measurement outcome is `superseded`, recover with `match_snapshot_superseded`, not `match_snapshot_published`

### 9.4 Layer 3 — read-time hard filters where possible

Move metadata-only hard filters toward read-time filtering:

| Setting              | Affects score/profile? | Handling                                                 |
| -------------------- | ---------------------- | -------------------------------------------------------- |
| Match % strictness   | no                     | read-time; already instant                               |
| Language filter      | no                     | move to read-time                                        |
| Vocal-gender filter  | no                     | move to read-time                                        |
| Release-year filter  | no                     | move to read-time                                        |
| Liked-at filter      | no                     | move to read-time; account-scoped metadata load required |
| Intent text          | yes                    | recompute profile/snapshot                               |
| Declared genre pills | yes                    | recompute profile/scoring weights                        |
| Playlist membership  | yes                    | recompute profile/snapshot                               |

If hard filters become read-time, snapshots must store enough broad candidate pairs to reveal matches when a filter is loosened.

Change the playlist-management change fact before moving filters:

```ts
type PlaylistManagementSessionFlushed = {
  kind: 'playlist_management_session_flushed';
  accountId: string;
  targetMembershipChanged: boolean;
  scoringConfigChanged: boolean; // intent text, declared genre pills, target profile inputs
  readTimeFilterChanged: boolean; // language, vocal gender, release year, liked-at
};
```

Reconciler behavior:

- `targetMembershipChanged || scoringConfigChanged` advances `matchSnapshotRefresh.requestedAt`
- `readTimeFilterChanged` alone does not enqueue refresh
- mixed saves with both flags set enqueue one refresh

Server/UI cache behavior:

- filter-only saves invalidate `matchReviewKeys.review`, `matchReviewSummaryKeys.summary`, and any currently visible `presentMatchReviewItem` query for affected orientation(s)
- if a card has already captured visible pairs, do not mutate the captured suggestion list; the filter change applies to future cards and future sessions

Incremental path:

- broaden stored pair retention with the song-top-N / playlist-top-N union from section 4.1
- keep filters/read strictness on top
- measure row volume before adding a separate broad candidate table

### 9.5 Layer 4 — early no-op hash check

If effective config hash matches latest snapshot, skip scoring/reranking before publish.

Lower priority than debounce/cancellation/read-time hard filters.

---

## 10. Implementation sequence

### Phase 0 — Reset current partial scoring changes

Do not commit the current WIP score/reranker read-path changes as-is. They are directionally useful but incomplete because they can make shown order diverge from logged rank.

Start implementation from a clean code baseline, then reintroduce `fused_score` gating through the shared helper and visible-suggestion-list architecture.

### Phase 1 — Types and helpers

- Add `MatchOrientation` / `MatchViewMode`.
- Add `strictnessScore`.
- Add visible-suggestion-list domain types.
- Add tests for strictness score fallback.

### Phase 2 — Schema

- Add `match_result_ranking`.
- Add queue/match-pass orientation support.
- Split queue item lifecycle into `state = pending | active | resolved` and `resolution = added | dismissed | skipped | unavailable | null`.
- Add `match_review_item_visible_pair` for presentation-suggestion-list capture.
- Add `served_orientation`, `model_rank`, and `visible_rank` to queue decision/event logging.
- Ensure RPCs can read `model_rank`, `visible_rank`, and orientation from captured visible-pair rows.
- Add `job.available_at` for refresh coalescing.
- Regenerate database types.

### Phase 3 — Refresh coalescing foundation

- Update claim RPC for `available_at`.
- Update `ensureMatchSnapshotRefreshJob` pending-job update behavior.
- Add scheduler debounce selection by change kind.

This should happen before enabling both ranking orientations to avoid avoidable cost spikes.

### Phase 4 — Ranking pipeline

- Replace `rerankMatches` with `rankMatchSuggestionLists`.
- Implement song and playlist orientation ranking.
- Add cooperative superseded checks before/inside ranking.
- Publish ranking metadata for both orientations.

### Phase 5 — Visible suggestion list and read paths

- Implement shared visible-suggestion-list helper.
- Implement `presentMatchReviewItem(itemId)` to capture first presentation and return captured rows.
- Update song-mode reads to render from captured rows for active cards.
- Add playlist-mode reads from the same capture path.
- Update prefetch/static reads so they cannot become the authoritative rendered suggestion list after capture ships.
- Update liked-song suggestions to use song orientation ranking directly, without presentation capture.

### Phase 6 — Queue/match-pass orientation

- Make queue creation/resume/append orientation-aware.
- Maintain independent active match passes per orientation.
- Queue ordering uses max visible `fused_score`.

### Phase 7 — UI toggle

- Add header toggle.
- Make mode URL/search-param backed with `/match` as canonical song mode and `/match?mode=playlist` as playlist mode.
- Preserve current song mode.
- Add playlist mode by swapping review item/suggestion components.
- Update control/completion/empty-state copy by orientation.
- Add inline scroll for song suggestions.

### Phase 8 — Mutations and event logging

- Make add/dismiss/skip orientation-aware.
- Validate action targets against `match_review_item_visible_pair`.
- Populate `served_orientation`, `model_rank`, and `visible_rank` from captured visible-pair rows.
- Keep finish/skip logging stable after one or more adds on the same card; do not re-dense visible ranks at action time.

### Phase 9 — Read-time hard filters

- Classify filters into read-time eligibility vs scoring/profile inputs.
- Split playlist-management change facts into `scoringConfigChanged` vs `readTimeFilterChanged`.
- Add `visibility_config_hash` to queue snapshot idempotency.
- Move safe hard filters to read-time.
- Adjust candidate cap if needed.
- Keep intent/genre/profile changes as recompute triggers.

### Phase 10 — Docs and cleanup

- Update `docs/architecture/matching/overview.md`.
- Update `docs/architecture/matching/reranker.md`.
- Document `match_result.score/rank` as legacy compatibility fields.
- Add UI stories for both modes.

---

## 11. Testing plan

### Unit tests

- `strictnessScore` uses `fused_score`, falls back to `score`.
- `retainStoredMatchPairs` stores the union of song-top-N and playlist-top-N pairs without duplicates.
- `rankSongSuggestionLists` groups by song and ranks playlists.
- `rankPlaylistSuggestionLists` groups by playlist and ranks songs.
- queue derivation preserves song-mode newness priority and otherwise uses max visible `strictnessScore(row)` per subject.
- visible suggestion list applies orientation-specific ownership/entitlement checks before sorting/visible-rank assignment.
- visible suggestion list filters/sorts/assigns visible rank correctly.
- first presentation capture persists `match_review_item_visible_pair` rows and retries return the same rows without re-densing.
- empty presentation capture sets `visible_pairs_captured_at`; retries do not recompute under changed filters.
- refresh debounce computes correct `available_at`.
- superseded check returns true for newer request marker.

### Server tests

- `getMatchReviewItem` song mode uses song ranking.
- `getMatchReviewItem` playlist mode uses playlist ranking.
- add mutation validates visible suggestion and writes orientation/ranks.
- dismiss derives same suggestion list as render.
- skip logs captured visible pairs with stable visible ranks after one or more adds.
- retryable card-load errors render Retry and do not call finish/skip.
- liked-song suggestions use song ranking.

### Integration tests

- ranking config/schema version participates in `snapshot_hash`, forcing one new snapshot after the refactor.
- `publish_match_snapshot` inserts both orientation ranking rows.
- legacy publish without nested rankings still works.
- active match passes are independent per orientation.
- pending match job is not claimed before `available_at`.
- second save during debounce updates the same pending job.
- immediate refresh trigger updates an existing debounced pending job to `available_at = now`.
- pending-job plan update preserves `needsTargetSongEnrichment` when any coalesced trigger needs it.
- superseded job exits without publishing and causes a fresh ensure.
- read-time filter hash lets the same snapshot append newly visible subjects after filters loosen.

### Component/stories

- Header renders toggle beside count.
- Song mode remains visually equivalent.
- Playlist mode swaps review item/suggestions.
- Song suggestion list scrolls inline.
- Playlist hover preview still works.
- Song play affordance works in playlist-mode rows.

---

## 12. Acceptance criteria

- `/match` has a Song/Playlist toggle.
- Song mode preserves existing behavior and affordances.
- Playlist mode swaps roles without introducing extra UI.
- Strictness never uses reranker score.
- Shown match percent uses `fused_score` in both modes.
- Song mode orders playlists by song-oriented ranking.
- Playlist mode orders songs by playlist-oriented ranking.
- Queue subject ordering preserves song-mode newness priority and otherwise uses max visible `strictnessScore(row)` (`fused_score` with legacy `score` fallback).
- Add/dismiss/skip logs orientation, model rank, and captured visible rank.
- Rapid playlist config saves coalesce before job claim.
- Superseded running refreshes stop before expensive stale work.
- Hard filters that do not affect scoring can become instant read-time filters.

## 13. Explicit non-goals

- Do not calibrate reranker scores globally in this refactor.
- Do not delete `match_result.score` or `match_result.rank` yet.
- Do not patch a running job with new config mid-execution.
- Do not publish partial snapshots.
- Do not introduce UI beyond the mode toggle and necessary swapped-mode components.
