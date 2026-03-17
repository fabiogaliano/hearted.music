## Context

The active pipeline change made post-sync enrichment run end-to-end, but it also made the playlist-profile starvation problem easier to see:

- `playlist_profiling` runs in the orchestrator's Phase A prep work
- it loads destination playlist-member songs directly from the library tables
- those songs typically have no free enrichment yet unless they also happened to be processed elsewhere
- on first run, there are usually no member-song embeddings to average

The result is that `PlaylistProfilingService.computeProfile()` often persists empty profiles, and the current cache key is too weak to guarantee those empty profiles are invalidated once bootstrap inputs become available.

Relevant implementation points:

- `src/lib/workflows/enrichment-pipeline/stages/playlist-profiling.ts`
- `src/lib/domains/taste/playlist-profiling/service.ts`
- `src/lib/integrations/audio/service.ts`
- `src/lib/domains/enrichment/genre-tagging/service.ts`
- `src/lib/domains/enrichment/embeddings/service.ts`
- `src/lib/domains/enrichment/embeddings/versioning.ts`

This design covers the **description-assisted bootstrap mode** only. It should not be read as the complete long-term playlist profiling design. The broader strategy can later include:

- a `playlist_only` mode built strictly from playlist-member songs, including analysis-backed signals
- a combined mode that merges playlist-member signals with playlist text

## Goals / Non-Goals

**Goals:**
- produce usable destination playlist profiles on the first pipeline run without LLM analysis for playlist members
- preserve the existing song-centroid profile path when member-song embeddings already exist
- ensure stale empty profiles are recomputed when description text or free/member-song aggregate signals change
- keep the change localized to profiling-stage and profiling-service code in a way that does not block future `playlist_only` or combined modes

**Non-Goals:**
- changing orchestrator stage order
- analyzing or embedding playlist-member songs via paid stages
- changing matching weights or matching service behavior
- adding a database column purely for observability (`playlist_profile.method`)
- fully specifying or implementing the future `playlist_only` or combined modes

## Decisions

### 1. Bootstrap inside the existing `playlist_profiling` stage

**Decision:** Keep all bootstrap work inside `src/lib/workflows/enrichment-pipeline/stages/playlist-profiling.ts` rather than adding a new stage.

**Rationale:** The current orchestrator shape is already correct for this follow-up. Profiling owns the destination-playlist loop and is the narrowest place to enrich playlist members before profile computation.

### 2. Reuse the existing free enrichment services for playlist-member songs

**Decision:** Use:

- `createAudioFeaturesService(createReccoBeatsService())`
- `createGenreEnrichmentService()`

inside the profiling stage for destination playlist members.

**Rationale:** Both services already implement cache-first behavior and persistence. Reusing them avoids duplicating readiness checks or introducing inconsistent fetch logic.

**Trade-off:** Profiling will perform additional free API work on destination playlist members. This is acceptable because the services already skip cached items, and the bootstrap path is explicitly limited to free signals.

### 3. Description text is a fallback embedding source, not the primary profile source

**Decision:** Add `descriptionText?: string` to `ProfilingOptions`, and only use it when the song-embedding centroid is empty.

**Implementation details:**
- normalize from `playlist.name` + `playlist.description`
- call `EmbeddingService.embedText(descriptionText, { prefix: "passage:" })`
- store that vector as the profile embedding only when no member-song centroid exists

**Rationale:** This preserves the existing learned-from-songs path while giving first-run matching a usable semantic signal.

**Compatibility note:** This fallback must remain additive so a future `playlist_only` mode can ignore description text entirely, and a future combined mode can fuse both sources deliberately rather than inheriting bootstrap behavior by accident.

### 4. Cache reuse must be based on the actual profile inputs

**Decision:** Replace the current song-id-only profile fingerprint with one derived from the profile inputs that materially affect the stored profile.

**Minimum inputs to fingerprint:**
- sorted `songIds`
- normalized `descriptionText` when playlist text shapes the stored profile
- rounded embedding centroid when available
- rounded audio centroid
- genre distribution

**Rationale:** A playlist profile should be recomputed when any of those inputs changes, even if playlist membership stays constant.

**Additional decision:** Bump `PLAYLIST_PROFILE_VERSION` in `src/lib/domains/enrichment/embeddings/versioning.ts` to invalidate existing stale rows created under the old profile semantics.

### 5. Defer explicit profile-method persistence

**Decision:** Do not include a required `playlist_profile.method` database column in this change.

**Rationale:** The bootstrap bug is about profile completeness and cache invalidation. Method persistence is useful for debugging, but it is not required to restore first-run matching and would be underspecified until the broader mode set (`playlist_only`, description-assisted bootstrap, combined) is settled.

## Risks / Trade-offs

**[Playlist descriptions can be sparse]** → Some playlists have weak or empty descriptions. In those cases, the bootstrap still benefits from audio + genre signals, and the embedding may remain null.

**[Additional free API calls]** → Destination playlist-member enrichment adds Last.fm/ReccoBeats traffic. Existing cache-first services and idempotent persistence keep repeat cost bounded.

**[Cache fingerprint complexity]** → Moving from song-id-only invalidation to input-based invalidation adds logic to `computeProfile()`, but it is required to prevent stale empty profiles from persisting.

**[No method column]** → Debugging the exact profile source remains less explicit. This is acceptable for the current scope.
