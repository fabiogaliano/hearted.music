# S1-11 · Billing-Aware Selector RPCs

## Goal

Implement the billing-aware selectors that replace the current ungated pipeline and match-refresh selectors: `select_liked_song_ids_needing_enrichment_work` and `select_entitled_data_enriched_liked_song_ids`.

## Why

The current selectors (`select_liked_song_ids_needing_pipeline_processing` and `select_data_enriched_liked_song_ids`) have no entitlement filtering. Phase B/C work and match-refresh candidates must be scoped by effective entitlement. These selectors define the contract the orchestrator consumes.

## Depends on

- S1-01 (core tables)
- S1-04 (entitlement predicate — used in both selectors)

## Blocks

- Phase 3 (enrichment selector integration, match refresh candidate filtering)

## Scope

### `select_liked_song_ids_needing_enrichment_work`
- Returns `TABLE (song_id UUID, needs_audio_features BOOLEAN, needs_genre_tagging BOOLEAN, needs_analysis BOOLEAN, needs_embedding BOOLEAN, needs_content_activation BOOLEAN)`
- `needs_audio_features` / `needs_genre_tagging`: shared artifact missing (no entitlement required)
- `needs_analysis` / `needs_embedding`: entitled AND shared artifact missing
- `needs_content_activation`: entitled, `song_analysis` exists, account-scoped `item_status` row missing
- Song returned when ANY flag is true
- Missing `item_status` is NOT a standalone selector reason for non-entitled songs
- Terminal failures excluded
- Ordered by most-recent-liked first
- Accepts `p_account_id UUID, p_limit INTEGER`

### `select_entitled_data_enriched_liked_song_ids`
- Returns `TABLE(song_id UUID)`
- Requires all 4 shared artifacts (audio features, genres, analysis, embedding)
- Requires effective entitlement
- Does NOT require `item_status`
- Accepts `p_account_id UUID`

Both: `SECURITY DEFINER`, `SET search_path = public`

## Out of scope

- Removing old selectors (done when orchestrator is rewired in Phase 3)
- TypeScript integration in batch.ts / orchestrator
- Content activation stage implementation

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_billing_aware_selectors.sql` |

## Constraints / decisions to honor

- Entitlement = `unlock row with revoked_at IS NULL` OR `active unlimited access`
- Provider-disabled accounts work through `self_hosted` unlimited access, not through selector bypass
- Stage flag names are frozen: `needs_audio_features`, `needs_genre_tagging`, `needs_analysis`, `needs_embedding`, `needs_content_activation`
- Selector may compute account-level billing facts once internally for efficiency

## Acceptance criteria

- [ ] Enrichment selector returns correct stage flags for: unlocked song missing analysis, locked song missing analysis (needs_analysis=false), song with all artifacts but missing item_status (needs_content_activation=true if entitled)
- [ ] Phase A flags (audio_features, genre_tagging) are true regardless of entitlement
- [ ] Phase B/C flags (analysis, embedding) require entitlement
- [ ] Content activation flag requires entitlement + analysis exists + item_status missing
- [ ] Match refresh selector returns only entitled + fully-enriched songs
- [ ] Revoked songs excluded from both selectors
- [ ] `self_hosted` accounts see all songs as entitled

## Verification

- SQL tests with various entitlement states (locked, unlocked, unlimited, self_hosted, revoked)
- `supabase db reset` completes

## Parallelization notes

- Can run in parallel with S1-05 through S1-10 (only needs S1-01 and S1-04)

## Suggested PR title

`feat(billing): billing-aware enrichment and match-refresh selector RPCs`
