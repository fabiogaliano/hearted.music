# Feature: Pipeline Gating & Entitlement Enforcement

> **Feature 03** · Dependency: Feature 02 (App Billing Domain)

## Goal

Make the app billing-safe: Phase B/C enrichment runs only for entitled songs, content activation is account-scoped, and every read model filters by effective entitlement so paid value is never leaked.

## Why it exists

This addresses the repo's highest-risk current-state problems identified in the audit:

1. **All enrichment stages run unconditionally** — LLM analysis and embedding (the paid value boundary) process every liked song without entitlement checks.
2. **Read models leak paid value** — `getLikedSongsPage`, `getSongMatches`, `getSongSuggestions`, `getDashboardStats`, and `fetchMatchPreviews` all serve `song_analysis` content and match data without entitlement filtering.
3. **`locked` and `pending` are conflated** — missing `account_item_newness` is treated as "pending processing" instead of distinguishing "not entitled" from "waiting for work."

This feature must complete before any hosted checkout or paywall work is shippable. Exposing purchase surfaces while value leaks through ungated pipelines and loaders undermines the entire monetization model.

## What this feature owns

### Workflow track — pipeline gating

- **Enrichment batch selector** updated to use `select_liked_song_ids_needing_enrichment_work` with per-song stage flags (`needs_audio_features`, `needs_genre_tagging`, `needs_analysis`, `needs_embedding`, `needs_content_activation`)
- **Enrichment orchestrator** runs each stage against exact sub-batches: Phase A (audio features + genres) for all songs, Phase B/C (analysis + embedding) only for entitled songs
- **Content activation stage** added: writes `account_item_newness` only for entitled songs with `song_analysis`; persists unlimited/self_hosted unlock rows for songs that became account-visible but lack durable unlock rows
- **`account_item_newness` semantics changed** — written only by content activation, not generic pipeline completion
- **Match snapshot refresh** — candidate selection uses `select_entitled_data_enriched_liked_song_ids` (entitled + all 4 shared artifacts)
- **Enrichment progress** — totals derived from planned stage work per song, not `songs × 4`
- **Candidate availability** — `newCandidatesAvailable` computed from before/after candidate snapshots across the selected set
- **Reconciler** — handles `songs_unlocked`, `unlimited_activated`, `candidate_access_revoked` change variants
- **Queue-band effects** — newly created work gets correct priority from billing state

### Read-model track — entitlement enforcement

- **Liked songs page** (`get_liked_songs_page` SQL RPC + `getLikedSongsPage` server function) — distinguishes `locked` from `pending`; does not expose `song_analysis` text for locked songs
- **Liked songs stats** (`get_liked_songs_stats` SQL RPC + `getLikedSongsStats` server function) — adds `locked` count; `pending` excludes locked songs
- **Dashboard stats** (`fetchDashboardStats`) — `analyzedPercent` and counts are billing-aware; only entitled analyzed songs count
- **Match previews** (`fetchMatchPreviews`) — entitlement filtering on which songs appear
- **Song suggestions** (`getSongSuggestions`) — entitlement check before exposing analysis/match data
- **Song matches** (`getSongMatches`) — does not serve `song_analysis.analysis` for locked songs
- **Matching session detail** (`getMatchingSession`) — entitlement filtering at read time; revoked songs disappear from UI without waiting for snapshot refresh
- **Feature types** — `SongDisplayState` replaces `UIAnalysisStatus` in `src/features/liked-songs/types.ts`; matching status is a sub-dimension of `analyzed` only

## What it does not own

- SQL schema, RPCs, or billing table definitions — Feature 01
- TypeScript billing domain types or env config — Feature 02
- Billing service, Stripe, or bridge HTTP — Feature 04
- Onboarding step sequencing — Feature 05
- Purchase/paywall/selection UI — Feature 06
- UI components or visual design for locked states (placeholder states are acceptable) — Feature 06

## Likely touchpoints

| Area | Files |
|---|---|
| Enrichment pipeline | `src/lib/workflows/enrichment-pipeline/batch.ts`, `orchestrator.ts`, `progress.ts`, `types.ts` |
| Enrichment stages | `src/lib/workflows/enrichment-pipeline/stages/*` |
| Match refresh | `src/lib/workflows/match-snapshot-refresh/orchestrator.ts` |
| Control plane | `src/lib/workflows/library-processing/reconciler.ts`, `service.ts` |
| Status queries | `src/lib/domains/library/liked-songs/status-queries.ts` |
| Server functions | `src/lib/server/liked-songs.functions.ts`, `matching.functions.ts`, `dashboard.functions.ts` |
| Feature types | `src/features/liked-songs/types.ts`, `src/features/matching/types.ts` |
| SQL RPCs | Underlying liked-songs, stats, and matching SQL RPCs in `supabase/migrations/` |
| Query cache | `src/features/liked-songs/queries.ts`, `src/features/dashboard/queries.ts`, `src/features/matching/queries.ts` |

## Dependencies

- Feature 01 complete (billing-aware selector RPCs exist)
- Feature 02 complete (billing domain types, `BillingChanges.*` helpers, control-plane change variants, queue-band mapping all stable)

## Downstream stories this feature should split into

### Workflow track

1. **Enrichment selector integration** — wire orchestrator to use `select_liked_song_ids_needing_enrichment_work`; parse per-song stage flags into sub-batches
2. **Per-song stage sub-batching in orchestrator** — run audio features and genre tagging on their sub-batch; run analysis and embedding only on entitled sub-batch
3. **Content activation stage** — implement activation step: write `account_item_newness` for entitled+analyzed songs; persist unlimited/self_hosted unlock rows; candidate snapshot delta
4. **Remove legacy pipeline-completion `account_item_newness` writes** — `markPipelineProcessed()` replaced by content activation; verify no other code path writes `account_item_newness` for non-entitled songs
5. **Enrichment progress accounting** — derive totals from planned stage work flags; include activation stage
6. **Match refresh candidate filtering** — use `select_entitled_data_enriched_liked_song_ids`; verify revoked songs excluded
7. **Reconciler billing-change handling** — process `songs_unlocked` (ensure enrichment work), `unlimited_activated` (trigger full-library scheduling), `candidate_access_revoked` (trigger snapshot refresh)

### Read-model track

8. **Liked songs page — locked/pending split** — update SQL RPC and server function to distinguish locked vs pending; do not expose analysis for locked songs
9. **Liked songs stats — billing-aware counts** — add locked count; pending excludes locked; analyzed counts only entitled songs
10. **Dashboard stats — billing-aware** — `analyzedPercent` counts only entitled analyzed songs
11. **Match/suggestion loaders — entitlement filtering** — filter by current entitlement at read time; revoked songs excluded immediately
12. **Feature type migration** — replace `UIAnalysisStatus` with `SongDisplayState`; update matching status to be sub-dimension of `analyzed`; update all consuming components

### Cross-cutting

13. **Provider-disabled validation** — verify `self_hosted` accounts pass through the same entitlement path; full library processes; no regressions from billing-unaware behavior

## Definition of done

- A locked song does not expose `song_analysis` text or match output anywhere in the app
- Phase B/C work requires effective entitlement (unlock row with `revoked_at IS NULL` OR active unlimited access)
- Phase A (audio features + genres) runs for all liked songs without billing gate
- `account_item_newness` is written only by content activation, not generic pipeline completion
- Content activation persists unlimited/self_hosted unlock rows for songs that became account-visible
- Match refresh uses only entitled + fully-enriched candidates
- Liked songs page shows `locked` for non-entitled songs, `pending` for entitled-but-unprocessed songs
- Stats (liked songs, dashboard) are billing-aware
- Match/suggestion loaders filter by entitlement at read time; revoked songs disappear immediately
- `SongDisplayState` is used throughout; `UIAnalysisStatus` is removed
- Provider-disabled accounts behave as unlimited through the same entitlement predicate
- Existing tests updated; new tests cover locked/pending distinction, stage sub-batching, activation, and read-model filtering
