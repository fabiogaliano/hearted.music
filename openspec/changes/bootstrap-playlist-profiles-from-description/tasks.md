## 1. Profiling options and cache semantics

- [x] 1.1 Update `src/lib/domains/taste/playlist-profiling/types.ts` to add `descriptionText?: string` to `ProfilingOptions`
- [x] 1.2 Update `src/lib/domains/taste/playlist-profiling/service.ts` so profile reuse is based on a fingerprint of the actual profile inputs rather than song IDs alone
- [x] 1.3 Bump `PLAYLIST_PROFILE_VERSION` in `src/lib/domains/enrichment/embeddings/versioning.ts` so previously persisted empty profiles are invalidated
- [x] 1.4 Keep the profiling-service changes additive so future `playlist_only` and combined modes can be introduced without reworking the cache or stage contract

## 2. Description fallback embedding

- [x] 2.1 Update `src/lib/domains/taste/playlist-profiling/service.ts` to keep the existing member-song embedding centroid path when available
- [x] 2.2 Add the description fallback path in `src/lib/domains/taste/playlist-profiling/service.ts` using `EmbeddingService.embedText(descriptionText, { prefix: "passage:" })` only when the centroid is empty

## 3. Playlist-member free-signal bootstrap in the profiling stage

- [x] 3.1 Update `src/lib/workflows/enrichment-pipeline/stages/playlist-profiling.ts` to backfill missing member-song audio features via `createAudioFeaturesService(createReccoBeatsService())`
- [x] 3.2 Update `src/lib/workflows/enrichment-pipeline/stages/playlist-profiling.ts` to backfill missing member-song genres via `createGenreEnrichmentService()`
- [x] 3.3 Re-read playlist-member songs after persistence and pass normalized `descriptionText` into `computeProfile()`

## 4. Regression coverage

- [x] 4.1 Extend `src/lib/domains/taste/playlist-profiling/__tests__/playlist-profiling-integration.test.ts` to cover bootstrap profiles with free signals + description fallback
- [x] 4.2 Extend `src/lib/workflows/enrichment-pipeline/__tests__/orchestrator.test.ts` to cover profiling-stage bootstrap behavior
- [x] 4.3 Extend `src/lib/workflows/enrichment-pipeline/__tests__/pipeline.integration.test.ts` to verify first-run profiles are non-empty and second-run profiles reuse cache when inputs are unchanged
- [x] 4.4 Add assertions that the bootstrap path does not override the song-derived path when member-song embeddings already exist
