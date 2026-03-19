## Why

The enrichment pipeline currently treats every trigger as a full six-stage run.

That no longer matches the product flow:

- sync should only run the song-side stages needed to enrich freshly synced liked songs
- saving destination playlists should only trigger destination-side follow-on work
- `savePlaylistDestinations()` currently behaves like a pipeline completion barrier even though the UI already advances to `ready` as soon as the save succeeds

Matching also creates duplicate `match_context` rows on retries because the pipeline stage derives `contextHash` from `Date.now()` instead of deterministic matching inputs.

This change aligns the orchestration boundaries with the product triggers while preserving backward compatibility for existing callers.

## What Changes

- **Trigger-scoped enrichment entry points**: split orchestration into `runSongEnrichment(accountId, options?)`, `runDestinationProfiling(accountId)`, and `runMatching(accountId, options?)`
- **Backward-compatible full wrapper**: keep `runEnrichmentPipeline(accountId, options?)` as sequential composition of the three trigger-scoped entry points
- **Sync boundary correction**: `POST /api/extension/sync` triggers only the four song-side stages (`audio_features`, `genre_tagging`, `song_analysis`, `song_embedding`)
- **Onboarding boundary correction**: saving destination playlists no longer waits for profiling or matching to finish before returning success to the UI
- **Deterministic matching idempotency**: matching computes a stable `contextHash` from playlist inputs, candidate inputs, config, and model/version metadata before creating a tracked job, and skips duplicate reruns when an identical context already exists
- **Explicit skip behavior**: destination-side work continues to skip cleanly when there are no selected destination playlists, no liked-song candidates, or no ready prerequisites

### Out of scope

- Introducing a brand-new queueing architecture unless the current runtime requires it for reliable follow-on work
- UI redesign or onboarding copy changes beyond clarifying the save/progression contract
- Changes to matching score composition, weights, or ranking behavior beyond deterministic context identity
- Playlist-profile bootstrap improvements from playlist descriptions

## Affected specs

- `extension-data-pipeline`
- `onboarding`
- `data-flow`
- `matching-pipeline`

## Capabilities

### Modified Capabilities

- **extension-data-pipeline**: sync-triggered enrichment is reduced to song-side stages only
- **onboarding**: destination playlist save succeeds independently of destination-side profiling/matching completion
- **data-flow**: enrichment follow-on work is split by trigger boundary, with a backward-compatible full wrapper for legacy callers
- **matching-pipeline**: pipeline-triggered matching uses deterministic context identity and avoids duplicate `match_context` creation on identical reruns

## Impact

- **Workflows**: `src/lib/workflows/enrichment-pipeline/orchestrator.ts` — split orchestration into trigger-scoped entry points plus compatibility wrapper
- **Matching stage**: `src/lib/workflows/enrichment-pipeline/stages/matching.ts` — deterministic context identity, duplicate-context short-circuit, and stronger skip behavior
- **Matching metadata helpers**: `src/lib/domains/taste/song-matching/cache.ts` and related queries/helpers — reuse or extract the authoritative hashing primitives
- **Onboarding server functions**: `src/lib/server/onboarding.functions.ts` — decouple playlist save from destination-side completion and trigger only destination-side follow-on work when needed
- **Sync route**: `src/routes/api/extension/sync.tsx` — call only song-side enrichment after sync
- **Tests**: `src/lib/workflows/enrichment-pipeline/__tests__/` plus integration coverage for trigger boundaries and matching idempotency
