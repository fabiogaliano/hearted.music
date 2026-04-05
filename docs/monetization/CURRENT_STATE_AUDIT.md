# Current State Audit — Monetization Foundation

> **Purpose:** Grounded snapshot of what exists in `v1_hearted/` today that is relevant to the monetization plan in `docs/MONETIZATION_V2_PLAN.md`. All claims are based on inspected code as of 2026-04-04. This document captures current behavior; the V2 plan remains the canonical future-state reference.

---

## 1. Existing Touchpoints

### Confirmed files/modules relevant to monetization

| Area | File | Relevance |
|---|---|---|
| **Queue priority** | `src/lib/workflows/library-processing/queue-priority.ts` | Stub exists. `resolveQueuePriority()` always returns `"low"`. `QueueBand` type (`low` / `standard` / `priority`) and `bandToNumeric()` are implemented. |
| **Control plane types** | `src/lib/workflows/library-processing/types.ts` | `LibraryProcessingChange` union — no billing variants yet. `LibraryProcessingEffect` — no billing-triggered effects yet. |
| **Control plane service** | `src/lib/workflows/library-processing/service.ts` | `applyLibraryProcessingChange()` — the single public entrypoint. Calls `resolveQueuePriority()` before creating jobs. |
| **Change helpers** | `src/lib/workflows/library-processing/changes/` | `onboarding.ts`, `sync.ts`, `enrichment.ts`, `match-snapshot.ts` — no `billing.ts` exists. |
| **Reconciler** | `src/lib/workflows/library-processing/reconciler.ts` | Pure reconciler. No billing-aware change kinds handled. |
| **Enrichment batch selector** | `src/lib/workflows/enrichment-pipeline/batch.ts` | Calls `select_liked_song_ids_needing_pipeline_processing` RPC. No entitlement filtering. |
| **Enrichment orchestrator** | `src/lib/workflows/enrichment-pipeline/orchestrator.ts` | Runs all stages for every selected song. No Phase A/B split. Calls `markPipelineProcessed()` at end. |
| **Enrichment stages** | `src/lib/workflows/enrichment-pipeline/stages/` | `audio-features.ts`, `genre-tagging.ts`, `song-analysis.ts`, `song-embedding.ts` — all run unconditionally per batch. |
| **Item status queries** | `src/lib/domains/library/liked-songs/status-queries.ts` | `markPipelineProcessed()`, `markItemsNew()`, `markSeen()`. No billing/entitlement awareness. |
| **Liked songs server fns** | `src/lib/server/liked-songs.functions.ts` | `getLikedSongsPage`, `getLikedSongsStats`, `getLikedSongBySlug`. No entitlement filtering — returns all songs with analysis data. |
| **Dashboard server fns** | `src/lib/server/dashboard.functions.ts` | `fetchDashboardStats` computes `analyzedPercent` from total liked songs vs `song_analysis` count. No billing-aware counts. |
| **Matching server fns** | `src/lib/server/matching.functions.ts` | `getSongMatches`, `getSongSuggestions`, `getMatchingSession`. Reads `song_analysis` content directly. No entitlement check on whether analysis should be visible. |
| **Onboarding server fns** | `src/lib/server/onboarding.functions.ts` | `getOnboardingData`, `markOnboardingComplete`, `savePlaylistTargets`. No plan-selection step. |
| **Onboarding types** | `src/features/onboarding/types.ts` | No billing-related router state. |
| **Onboarding steps enum** | `src/lib/domains/library/accounts/preferences-queries.ts` | `ONBOARDING_STEPS = z.enum(["welcome", "pick-color", "install-extension", "syncing", "flag-playlists", "ready", "complete"])`. No `song-showcase`, `match-showcase`, or `plan-selection`. |
| **ReadyStep component** | `src/features/onboarding/components/ReadyStep.tsx` | Copy: "Going through every song. An email's on its way when it's ready." Assumes ungated full-library processing for all users. |
| **Sidebar** | `src/routes/_authenticated/-components/Sidebar.tsx` | Accepts `userPlan: string` prop. Currently hardcoded as `"Free Plan"` from `route.tsx`. No balance display. |
| **Authenticated layout** | `src/routes/_authenticated/route.tsx` | Passes `userPlan="Free Plan"` to Sidebar. No billing state loading. |
| **Settings page** | `src/features/settings/SettingsPage.tsx` | Theme, extension status, sign out. No billing/subscription section. |
| **Env config** | `src/env.ts` | No `BILLING_PROVIDER_ENABLED`, `BILLING_SERVICE_URL`, `BILLING_SHARED_SECRET`, or `BILLING_OFFER_QUARTERLY_ENABLED` flags. |
| **Account provisioning** | `src/lib/domains/library/accounts/queries.ts` | `createAccountForBetterAuthUser()` — creates account row only. No billing row creation. |
| **Auth server** | `src/lib/platform/auth/auth.server.ts` | Session → account lookup. No billing state in session context. |
| **Liked songs types** | `src/features/liked-songs/types.ts` | `UIAnalysisStatus = "not_analyzed" \| "analyzing" \| "analyzed" \| "failed"`. No `"locked"` state. `MatchingStatus = "pending" \| "has_suggestions" \| "acted" \| "no_suggestions"`. No `"locked"` state. |
| **Devtools reset** | `src/lib/workflows/library-processing/devtools/reset.ts` | `warmReplayReset()` clears `item_status`, match snapshots, library processing state. No billing table awareness. |
| **Devtools reseed** | `src/lib/workflows/library-processing/devtools/reseed.ts` | Seeds work from current liked songs / target playlists. No billing state seeding. |
| **Reset onboarding script** | `scripts/reset-onboarding.ts` | Exists for dev use. No billing state reset. |
| **Match snapshot refresh** | `src/lib/workflows/match-snapshot-refresh/` | Uses `select_data_enriched_liked_song_ids` RPC. No entitlement filtering. |

### Domain directory structure

```
src/lib/domains/
├── enrichment/       (audio-features, content-analysis, embeddings, genre-tagging, lyrics)
├── library/          (accounts, artists, liked-songs, playlists, songs)
└── taste/            (playlist-profiling, song-matching)
```

`src/lib/domains/billing/` does **not** exist.

---

## 2. Confirmed Current Behavior

### Pipeline processing is fully ungated

Every liked song gets all enrichment stages unconditionally:
1. `audio_features` (ReccoBeats)
2. `genre_tagging` (Last.fm)
3. `song_analysis` (LLM)
4. `song_embedding` (embedding model)
5. `markPipelineProcessed()` (writes `item_status`)

The selector RPC `select_liked_song_ids_needing_pipeline_processing` returns songs missing **any** of the 4 shared artifacts OR missing `item_status`. There is no entitlement check.

### Read models expose all analysis data without entitlement checks

- **Liked songs page** (`get_liked_songs_page` SQL RPC): returns analysis content for any song that has a `song_analysis` row. No unlock/entitlement join.
- **Liked songs stats** (`get_liked_songs_stats` SQL RPC): `analyzed` count = songs with `song_analysis` row. `pending` = songs without `item_status` row. No locked/entitled distinction.
- **Dashboard stats** (`fetchDashboardStats`): `analyzedPercent` = `analyzedCount / totalSongs`. Uses `getAnalyzedCountForAccount` which counts `song_analysis` rows. No entitlement filter.
- **Match previews** (`fetchMatchPreviews`): reads `match_result` rows directly. No entitlement filtering on which songs can appear.
- **Song suggestions** (`getSongSuggestions`): reads `match_result` + `match_decision`. No entitlement check. Analysis content is served directly.
- **Song matches** (`getSongMatches`): reads `song_analysis.analysis` JSONB directly for any matched song. No entitlement check.

### Queue priority is always `low`

`resolveQueuePriority()` returns `"low"` unconditionally (confirmed: the function body is a single `return "low"` with a comment noting billing/entitlement data doesn't exist yet).

### Onboarding assumes full-library processing

- Steps: `welcome` → `pick-color` → `install-extension` → `syncing` → `flag-playlists` → `ready` → `complete`
- No `song-showcase`, `match-showcase`, or `plan-selection` steps
- `ReadyStep` copy says "Going through every song"
- `markOnboardingComplete()` sets `onboarding_completed_at` timestamp — no billing provisioning

### Account creation has no billing provisioning

`createAccountForBetterAuthUser()` inserts into `account` table only. No `account_billing` row is created. No `self_hosted` unlimited access provisioning.

### Sidebar plan display is hardcoded

`route.tsx` passes `userPlan="Free Plan"` to `Sidebar`. The Sidebar renders this as a static label. No billing state lookup.

### No billing env vars exist

`.env.example` has no `BILLING_*` entries. `src/env.ts` has no billing-related schema.

### Settings page has no billing section

Only: theme selection, extension status, sign out.

---

## 3. Missing Billing Foundation

### Schema (none exists)

- [ ] `account_billing` table
- [ ] `account_song_unlock` table
- [ ] `pack_credit_lot` table
- [ ] `subscription_credit_conversion` table
- [ ] `subscription_credit_conversion_allocation` table
- [ ] `credit_transaction` table
- [ ] `billing_webhook_event` table
- [ ] `billing_activation` table
- [ ] `billing_bridge_event` table
- [ ] `song_analysis` measurement columns (`provider`, `input_tokens`, `output_tokens`, `cost_usd`)

### RPCs (none exist)

- [ ] `unlock_songs_for_account`
- [ ] `insert_song_unlocks_without_charge`
- [ ] `activate_unlimited_songs`
- [ ] `grant_credits`
- [ ] `fulfill_pack_purchase`
- [ ] `reverse_pack_entitlement`
- [ ] `reverse_unlimited_period_entitlement`
- [ ] `prepare_subscription_upgrade_conversion`
- [ ] `link_subscription_upgrade_checkout`
- [ ] `release_subscription_upgrade_conversion`
- [ ] `apply_subscription_upgrade_conversion`
- [ ] `reverse_subscription_upgrade_conversion`
- [ ] `activate_subscription`
- [ ] `deactivate_subscription`
- [ ] `update_subscription_state`
- [ ] `reprioritize_pending_jobs_for_account`
- [ ] `select_liked_song_ids_needing_enrichment_work` (billing-aware replacement for current selector)
- [ ] `select_entitled_data_enriched_liked_song_ids` (billing-aware replacement for current match refresh selector)
- [ ] `is_account_song_entitled` (entitlement predicate)

### Application code (none exists)

- [ ] `src/lib/domains/billing/` domain (state, queries, unlocks, offers)
- [ ] `BillingChanges.*` helpers (`songsUnlocked`, `unlimitedActivated`, `candidateAccessRevoked`)
- [ ] Billing change variants in `LibraryProcessingChange` union
- [ ] Billing-aware `resolveQueuePriority()` implementation
- [ ] Billing state read model (`BillingState` type)
- [ ] `getBillingState` server function
- [ ] `requestSongUnlock` server function
- [ ] `createCheckoutSession` / `createPortalSession` bridge server functions
- [ ] Billing bridge ingress endpoint
- [ ] Billing row creation in account provisioning hook
- [ ] Account activation stage in enrichment orchestrator

### Env / config (none exists)

- [ ] `BILLING_PROVIDER_ENABLED` env var
- [ ] `BILLING_SERVICE_URL` env var
- [ ] `BILLING_SHARED_SECRET` env var
- [ ] `BILLING_OFFER_QUARTERLY_ENABLED` env var

### UI (none exists)

- [ ] Song selection UI for pack users
- [ ] Paywall / upgrade CTA
- [ ] Balance display in sidebar
- [ ] Settings/billing section
- [ ] Onboarding `song-showcase` step
- [ ] Onboarding `match-showcase` step
- [ ] Onboarding `plan-selection` step
- [ ] Locked song states in liked songs UI
- [ ] Post-checkout polling/success state

### External services (none exist)

- [ ] `v1_hearted_brand/` billing service
- [ ] Stripe test-mode products
- [ ] `billing.hearted.music` deployment

---

## 4. Current Semantics That Matter

### Missing `item_status` means "pending" (not "locked")

The current `get_liked_songs_stats` SQL RPC defines:
```sql
-- pending: no item_status row
COUNT(*) FILTER (WHERE NOT EXISTS (
  SELECT 1 FROM item_status ist
  WHERE ist.item_id = ls.song_id
    AND ist.account_id = ls.account_id
    AND ist.item_type = 'song'
))
```

The `get_liked_songs_page` RPC derives `matching_status`:
- No `item_status` row → `'pending'` (rendered as pipeline hasn't processed yet)
- Has `item_status` + match results with undecided → `'has_suggestions'`
- Has `item_status` + all decided → `'acted'`
- Has `item_status` + no match results → `'no_suggestions'`

**Impact:** Under billing, "no `item_status`" could mean **locked** (not entitled) or **pending** (entitled but not processed). These are distinct states that the current SQL cannot distinguish.

### `item_status` is written by pipeline completion, not by entitlement

`markPipelineProcessed()` writes `item_status` after all enrichment stages finish. This is the only write path. Under billing, `item_status` should mean "account-visible content has been activated" and should only be written by the account-activation step for entitled songs.

### Queue priority defaults to `low` for all accounts

All jobs currently get `queue_priority = 0` (`low` band). The `job` table has `queue_priority INTEGER` column (added in migration `20260327200343`). The infrastructure is ready, but billing-aware resolution is stubbed.

### Onboarding steps are a z.enum stored in `user_preferences`

`ONBOARDING_STEPS` is a Zod enum. Adding `song-showcase`, `match-showcase`, `plan-selection` requires:
1. Extending the Zod enum
2. Altering the DB enum (if `user_preferences.onboarding_step` uses a DB-level enum — confirmed: it's stored as text matching the Zod validation, not a DB enum)
3. Updating the step config in `Onboarding.tsx`
4. New step components

### `song_analysis` is a shared global artifact

`song_analysis` rows are not account-scoped. Multiple accounts sharing the same liked song share the same analysis. This is correct for COGS but means **the read models must filter by entitlement**, not by `song_analysis` existence, to avoid leaking paid value.

### `match_result` is account-scoped via `match_snapshot.account_id`

Match results are already account-scoped through the snapshot. However, they currently don't check whether the account is **entitled** to see those results. A song could have a match result from a prior unlimited period that was later refunded.

### `match_snapshot` rename happened

Migration `20260402235223_rename_match_context_to_match_snapshot.sql` renamed `match_context` → `match_snapshot`. But some SQL RPCs still reference `match_context` (e.g., `get_liked_songs_stats` uses `FROM match_context mc`). The rename migration likely updated the table but older function definitions in the migration history still show `match_context`. Need to verify if the latest function definitions reference the correct name.

### `select_data_enriched_liked_song_ids` has no entitlement filter

This RPC returns all liked songs with all 4 shared artifacts. Under billing, match refresh candidates must also be entitled. This selector must be replaced with `select_entitled_data_enriched_liked_song_ids`.

### `select_liked_song_ids_needing_pipeline_processing` treats all stages equally

Returns songs missing **any** artifact. Does not distinguish Phase A (free) from Phase B/C (gated). Under billing, Phase A should run for all songs; Phase B/C only for entitled songs.

### Account table has no billing columns

`account` table: `id`, `spotify_id`, `email`, `display_name`, `better_auth_user_id`, `image_url`, `created_at`, `updated_at`. No plan, balance, or Stripe references. All billing state goes in the new `account_billing` table.

### RLS pattern: enable + deny-all + service_role bypass

All existing tables follow this pattern. New billing tables must match.

### Function search path hardening exists

Migration `20260330000001_fix_function_search_paths.sql` pins `search_path = public` on existing `SECURITY DEFINER` functions. New billing RPCs must include `SET search_path = public` at creation time.

---

## 5. Known Stale References / Assumptions

### `ReadyStep` copy assumes full-library processing
`"Going through every song. An email's on its way when it's ready."` — must change to reflect billing-aware behavior (free: 15 songs, pack: selected songs, unlimited: full library).

### Sidebar hardcodes `"Free Plan"`
`route.tsx` line: `userPlan="Free Plan"`. Must be derived from billing state.

### Stats SQL may reference old `match_context` table name
The `get_liked_songs_stats` function in migration `20260319050000` joins `match_context`. If the rename migration rewrote this function, it's fine. If not, the runtime function references a non-existent table (or an alias). Needs verification against the actual deployed function definition.

### `UIAnalysisStatus` has no `"locked"` value
`"not_analyzed" | "analyzing" | "analyzed" | "failed"` — needs a locked state for songs that exist but the user isn't entitled to see.

### `MatchingStatus` has no locked concept
`"pending" | "has_suggestions" | "acted" | "no_suggestions"` — a locked song should not show any of these statuses.

### No billing-related legal/FAQ copy
`docs/MONETIZATION_V2_PLAN.md` edge case #20 notes that public legal/FAQ copy will be inconsistent. The existing `/faq`, `/privacy`, `/terms` routes would need updates.

---

## 6. Integration Points Likely to Change

### Routes (confirmed touchpoints → likely future changes)

| Route file | Current role | Change needed |
|---|---|---|
| `_authenticated/route.tsx` | Auth guard, onboarding redirect, sidebar layout | Load billing state, pass dynamic plan label, add billing to route context |
| `_authenticated/onboarding.tsx` | Onboarding route | Support new steps, conditional skip of plan-selection |
| `_authenticated/dashboard.tsx` | Dashboard route | Billing-aware stats in loader |
| `_authenticated/liked-songs.tsx` | Liked songs route | Billing-aware song states |
| `_authenticated/match.tsx` | Matching route | Entitlement filtering |
| `_authenticated/settings.tsx` | Settings route | Billing section |
| *New: billing bridge API route* | Does not exist | Bridge endpoint for billing-service → app calls |

### Server functions (confirmed touchpoints → likely future changes)

| Server function file | Change needed |
|---|---|
| `liked-songs.functions.ts` | Locked vs pending semantics, entitlement filtering |
| `matching.functions.ts` | Entitlement check before exposing analysis/match data |
| `dashboard.functions.ts` | Billing-aware analyzed counts and match previews |
| `onboarding.functions.ts` | Plan-selection, free auto-allocation, billing provisioning |
| `settings.functions.ts` | Billing/subscription management section |
| *New: billing.functions.ts* | Does not exist. `getBillingState`, `requestSongUnlock`, checkout/portal bridges |

### SQL RPCs (confirmed touchpoints → replacements needed)

| RPC | Change |
|---|---|
| `get_liked_songs_page` | Must distinguish locked from pending; must not expose analysis for locked songs |
| `get_liked_songs_stats` | Must add locked count; pending must exclude locked songs |
| `select_liked_song_ids_needing_pipeline_processing` | Replace with `select_liked_song_ids_needing_enrichment_work` (per-song stage flags) |
| `select_data_enriched_liked_song_ids` | Replace with `select_entitled_data_enriched_liked_song_ids` |

### Generated DB types

`src/lib/data/database.types.ts` — auto-generated from Supabase schema. Every new table, RPC, and enum value will require regeneration.

### Account provisioning

`src/lib/domains/library/accounts/queries.ts` — `createAccountForBetterAuthUser()` must also create `account_billing` row. When `BILLING_PROVIDER_ENABLED=false`, must also set `unlimited_access_source = 'self_hosted'`.

The Better Auth hook that calls this function (likely in `auth.ts` or `auth.server.ts`) must be updated.

### Reset/reseed scripts

| File | Change needed |
|---|---|
| `src/lib/workflows/library-processing/devtools/reset.ts` | Must clear billing-related state (or at least not break if billing tables exist) |
| `src/lib/workflows/library-processing/devtools/reseed.ts` | Must seed billing state for test accounts |
| `scripts/reset-onboarding.ts` | Must handle billing state reset |

### Query/cache layers

| Layer | Change needed |
|---|---|
| `src/features/liked-songs/queries.ts` | Query keys may need billing state dependency |
| `src/features/dashboard/queries.ts` | Stats queries need invalidation on billing changes |
| `src/features/matching/queries.ts` | Session/song queries need billing awareness |
| TanStack Query cache invalidation in `useActiveJobs` | Must handle billing-triggered job completions |

### Enrichment pipeline

| File | Change needed |
|---|---|
| `orchestrator.ts` | Per-song stage sub-batching, account activation stage |
| `batch.ts` | New selector with stage-level flags |
| `progress.ts` | Totals from planned stage work, not `songs × 4` |
| `types.ts` | `EnrichmentContext` may need billing awareness |

### Library processing control plane

| File | Change needed |
|---|---|
| `types.ts` | Add `songs_unlocked`, `unlimited_activated`, `candidate_access_revoked` change variants |
| `reconciler.ts` | Handle new billing change variants |
| `service.ts` | Process billing-triggered effects |
| `queue-priority.ts` | Resolve from billing state instead of returning `"low"` |

---

## 7. Highest-Risk Current-State Facts

1. **Read models leak paid value.** Every server function (`getLikedSongsPage`, `getSongMatches`, `getSongSuggestions`, `getDashboardStats`, `fetchMatchPreviews`) serves `song_analysis` content and match data without entitlement checks. This is the #1 architectural concern for monetization: billing enforcement at read time is a first-class requirement, not a polish pass.

2. **`item_status` absence = pending, not locked.** The entire liked-songs read model and stats SQL conflate "not yet processed" with "not entitled." Splitting these into distinct states touches SQL RPCs, server functions, TypeScript types, and UI components simultaneously.

3. **Pipeline has no Phase A/B split.** The orchestrator runs all 4 stages unconditionally. The selector returns a flat list. Introducing per-song stage flags and conditional execution is the deepest pipeline change.

4. **No billing domain exists.** No tables, no RPCs, no TypeScript domain module, no env flags. Phase 1 of the V2 plan is entirely greenfield.

5. **Account provisioning has no billing hook.** New accounts get no `account_billing` row. Provider-disabled/self-hosted mode requires explicit `self_hosted` unlimited access provisioning — this doesn't exist.

6. **Queue priority is inert.** The infrastructure is wired (column exists, `bandToNumeric` works, `resolveQueuePriority` is called) but returns a constant. All jobs are `low` priority.

7. **Onboarding is missing 3 steps.** `song-showcase`, `match-showcase`, `plan-selection` do not exist. The step enum is a Zod string enum, so extension is straightforward, but the components and demo-song infrastructure are unbuilt.

8. **`ReadyStep` copy is billing-unaware.** Hardcoded "Going through every song" message must be parameterized by plan.

9. **Devtools reset/reseed don't know about billing.** Adding billing tables without updating reset paths will cause incomplete resets in dev.

10. **Match refresh candidate selector has no entitlement filter.** `select_data_enriched_liked_song_ids` returns all enriched songs. Under billing, revoked or locked songs must be excluded from matching candidates.
