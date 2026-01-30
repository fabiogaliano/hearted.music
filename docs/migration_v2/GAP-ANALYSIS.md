# Migration v2 Gap Analysis

> Comprehensive audit of old_app vs v1 implementation status, identifying missing components.

**Date**: January 21, 2026
**Scope**: Full service layer comparison

---

## Executive Summary

The migration from v0 (old_app) to v1 is **~98% complete** for the service layer. All matching pipeline services have been ported and integrated. Only UI integration (Phase 7) and cleanup tasks (Phase 6) remain.

| Category                          | old_app | v1  | Gap               |
| --------------------------------- | ------- | --- | ----------------- |
| Infrastructure (auth, sync, jobs) | ✅       | ✅   | None              |
| Analysis (LLM, lyrics)            | ✅       | ✅   | None              |
| Embedding (vectors)               | ✅       | ✅   | None              |
| **Matching (core algorithm)**     | ✅       | ✅   | **None**          |
| **Genre enrichment**              | ✅       | ✅   | **None**          |
| **Playlist profiling**            | ✅       | ✅   | **None**          |
| **SSE job progress**              | ✅       | ✅   | **None**          |
| **ML provider abstraction**       | ❌       | ✅   | v1 improvement    |
| UI (Onboarding)                   | ✅       | ✅   | None              |
| UI (Dashboard/Matching)           | ✅       | 🟡   | In progress       |

**Status Update (2026-01-21)**:
- ✅ All matching pipeline services (Phases 4e-4g) implemented
- ✅ SSE job progress (Phase 5) complete
- ✅ ML provider abstraction added (not in v0, new capability)
- ✅ Cache persistence to DB complete
- ✅ Smoke tests validate full pipeline functionality
- ✅ Phase 7a (Onboarding UI) complete (2026-01-30)
- 🟡 Remaining work: Phase 7b (Dashboard/Matching UI) and Phase 6 (cleanup)

---

## ✅ Completed: Matching Pipeline (2026-01-21)

**Status**: All services ported and integrated (~5,343+ lines)

### Phase 4e: Core Matching (✅ 2,443 lines)

| File                                   | Lines | Status | v1 Location |
| -------------------------------------- | ----- | ------ | ----------- |
| `matching/MatchingService.ts`          | 1493  | ✅      | `capabilities/matching/service.ts` (440 lines) |
| `matching/MatchCachingService.ts`      | 534   | ✅      | `capabilities/matching/cache.ts` (507 lines) |
| `matching/matching-config.ts`          | 85    | ✅      | `capabilities/matching/config.ts` (173 lines) |
| `semantic/SemanticMatcher.ts`          | 306   | ✅      | `capabilities/matching/semantic.ts` (300 lines) |
| `vectorization/analysis-extractors.ts` | 354   | ✅      | `ml/embedding/extractors.ts` (354+ lines) |
| `vectorization/hashing.ts`             | 327   | ✅      | `ml/embedding/hashing.ts` (327+ lines) |
| Additional scoring + types             | —     | ✅      | `capabilities/matching/scoring.ts` (301 lines), `types.ts` (222 lines) |

### Phase 4f: Genre Enrichment (✅ 1,200+ lines)

| File                              | Lines | Status | v1 Location |
| --------------------------------- | ----- | ------ | ----------- |
| `lastfm/LastFmService.ts`         | 311   | ✅      | `integrations/lastfm/service.ts` (311+ lines) |
| `lastfm/utils/genre-whitelist.ts` | 469   | ✅      | `integrations/lastfm/whitelist.ts` (469+ lines) |
| `lastfm/utils/normalize.ts`       | 81    | ✅      | `integrations/lastfm/normalize.ts` (81+ lines) |
| `genre/GenreEnrichmentService.ts` | 477   | ✅      | `capabilities/genre/service.ts` (294 lines) |

### Phase 4g: Playlist Profiling (✅ 800+ lines)

| File                                    | Lines | Status | v1 Location |
| --------------------------------------- | ----- | ------ | ----------- |
| `profiling/PlaylistProfilingService.ts` | 770   | ✅      | `capabilities/profiling/service.ts` (253 lines) |
| `reccobeats/ReccoBeatsService.ts`       | 226   | ✅      | `integrations/reccobeats/service.ts` (226+ lines) |
| `audio/AudioFeaturesService.ts`         | 45    | ✅      | `integrations/audio/service.ts` (45+ lines) |

### Testing Status
- ✅ 6 smoke tests covering full pipeline
- ✅ 2 unit test suites (semantic, scoring)
- 🟡 E2E integration tests in progress

### Next Steps
1. Run comprehensive E2E testing with production data
2. Performance tuning (<5s target for 500 songs × 20 playlists)
3. UI integration (Phase 7) - matching results display

---

## What's Already Done (v1)

### ✅ Services Ported

| Service                 | Location                         | Status     |
| ----------------------- | -------------------------------- | ---------- |
| SpotifyService          | `integrations/spotify/`          | ✅ Complete |
| LlmService              | `ml/llm/service.ts`              | ✅ Complete |
| LyricsService           | `capabilities/lyrics/service.ts` | ✅ Complete |
| SongAnalysisService     | `capabilities/analysis/`         | ✅ Complete |
| PlaylistAnalysisService | `capabilities/analysis/`         | ✅ Complete |
| AnalysisPipeline        | `capabilities/analysis/`         | ✅ Complete |
| DeepInfraService        | `integrations/deepinfra/`        | ✅ Complete |
| EmbeddingService        | `ml/embedding/service.ts`        | ✅ Complete |
| RerankerService         | `ml/reranker/service.ts`         | ✅ Complete |
| SyncOrchestrator        | `capabilities/sync/`             | ✅ Complete |
| PlaylistSyncService     | `capabilities/sync/`             | ✅ Complete |
| JobLifecycleService     | `jobs/lifecycle.ts`              | ✅ Complete |
| **MatchingService**     | `capabilities/matching/`         | ✅ Complete |
| **GenreEnrichment**     | `capabilities/genre/`            | ✅ Complete |
| **PlaylistProfiling**   | `capabilities/profiling/`        | ✅ Complete |
| **LastFmService**       | `integrations/lastfm/`           | ✅ Complete |
| **ReccoBeatsService**   | `integrations/reccobeats/`       | ✅ Complete |
| **ML Provider Factory** | `ml/provider/factory.ts`         | ✅ Complete |
| **SSE Job Progress**    | `jobs/progress/`, `routes/api`   | ✅ Complete |

### ✅ Data Layer Complete

All 13 query modules implemented (plus `client.ts` for Supabase clients):
- `song.ts`, `liked-song.ts`, `playlists.ts`
- `song-analysis.ts`, `playlist-analysis.ts`, `song-audio-feature.ts`
- `vectors.ts`, `matching.ts`, `jobs.ts`, `accounts.ts`
- `newness.ts`, `preferences.ts`, `auth-tokens.ts`

### ✅ Database Schema Complete

All 17 tables created with RLS (deny-all, service-role access).

---

## Root Cause Analysis

**Why was this missed?**

1. **SERVICES.md Ambiguity**: Listed services as "KEEP" without clarifying they needed to be ported
2. **Roadmap Gap**: Phases 4a-4d covered infrastructure; no phase for core business logic
3. **Fresh Port Assumption**: "N/A for v1 fresh port" was used for deletions but not for ports
4. **Focus on Infrastructure**: Migration prioritized auth, sync, data layer over algorithm

**The phrase "Services to KEEP" was interpreted as "don't delete" rather than "need to port".**

---

## Updated Phase Dependencies

```
Phase 0-3: Foundation ─────────────────────────────► ✅ Complete
     │
     ├─► Phase 4a-4d: Infrastructure ──────────────► ✅ Complete
     │
     ├─► Phase 4e: Matching Pipeline ──────────────► ✅ Complete (minor gaps)
     │        │
     │        └─► Phase 4g: Playlist Profiling ────► ✅ Complete
     │
     └─► Phase 4f: Genre Enrichment ───────────────► ✅ Complete
              │
              └─► Enhances matching quality

Phase 5: SSE ──────────────────────────────────────► ✅ Complete
Phase 6: Cleanup ──────────────────────────────────► ⬜ Ready to start
Phase 7a: Onboarding UI ───────────────────────────► ✅ Complete
Phase 7b: Dashboard/Matching UI ───────────────────► 🟡 Prototypes ready
```

---

## Effort Estimate

| Phase        | Lines      | Complexity           | Estimate     |
| ------------ | ---------- | -------------------- | ------------ |
| 4e Matching  | ~3,100     | High (algorithm)     | 2-3 days     |
| 4f Genre     | ~1,260     | Medium (API)         | 1 day        |
| 4g Profiling | ~1,040     | Medium (aggregation) | 1 day        |
| **Total**    | **~5,400** |                      | **4-5 days** |

**Note**: Much of this is port work, not new development. The algorithms are battle-tested in old_app.

---

## Recommendations

### Immediate Actions

1. ✅ Update ROADMAP.md with Phases 4e-4g (done)
2. ✅ Update SERVICES.md with accurate status (done)
3. ✅ Create matching-pipeline spec in openspec (done)
4. ⬜ Begin Phase 4e implementation

### Phase 4e Approach

1. Port `matching-config.ts` first (defines weights)
2. Port `analysis-extractors.ts` + `hashing.ts` (required by embedding)
3. Port `SemanticMatcher.ts` (standalone, testable)
4. Port `MatchingService.ts` (core algorithm)
5. Port `MatchCachingService.ts` (orchestration layer)
6. Integration test with known song-playlist pairs

### Quality Gates

- [ ] Matching returns ranked results for test songs
- [ ] Scores are deterministic (same input = same output)
- [ ] Cache hits avoid recomputation
- [ ] Performance: <5s for 500 songs × 20 playlists

---

## Known Gaps / Technical Debt

| Gap | Location | Impact | Fix |
|-----|----------|--------|-----|
| **Cache in-memory only** | `matching/cache.ts` | Lost on restart | Wire to `data/matching.ts` (~2-4h) |
| **Extractors unused** | `embedding/extractors.ts` | Tech debt only | Defer - works without |

**Cache details**: `data/matching.ts` has persistence functions ready (`createMatchContext`, `insertMatchResults`). Need to add `getMatchContextByHash()` for lookup. See `old_app/lib/services/matching/MatchCachingService.ts` for reference.

---

## Documentation Updated

| File                                       | Change                             |
| ------------------------------------------ | ---------------------------------- |
| `docs/migration_v2/ROADMAP.md`             | Added Phases 4e, 4f, 4g with tasks |
| `docs/migration_v2/02-SERVICES.md`         | Clarified PORT vs PORTED status    |
| `openspec/specs/migration-v2/spec.md`      | Updated phase table with status    |
| `openspec/specs/matching-pipeline/spec.md` | NEW - Full matching spec           |
| `docs/migration_v2/GAP-ANALYSIS.md`        | NEW - This document                |

---

## Frontend Status

> UI prototypes are ~85% complete in `old_app/prototypes/warm-pastel/` (88 files).

The frontend is not a gap - it's ready to wire to real APIs once backend services are complete. Includes:
- Landing, Onboarding (6 steps), Dashboard, Matching, Liked Songs, Playlists, Settings
- Full design system with 4 themes (blue, green, rose, lavender)
- FLIP animations, infinite scroll, keyboard shortcuts

---

*Created: January 20, 2026*
