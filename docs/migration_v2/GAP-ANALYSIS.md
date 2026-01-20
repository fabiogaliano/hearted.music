# Migration v2 Gap Analysis

> Comprehensive audit of old_app vs v1 implementation status, identifying missing components.

**Date**: January 20, 2026
**Scope**: Full service layer comparison

---

## Executive Summary

The migration from v0 (old_app) to v1 is **~60% complete** for the service layer. Critical business logic for song-to-playlist matching was marked "KEEP" in the original plan but had **no roadmap phase to actually port it**.

| Category                          | old_app | v1  | Gap          |
| --------------------------------- | ------- | --- | ------------ |
| Infrastructure (auth, sync, jobs) | ✅       | ✅   | None         |
| Analysis (LLM, lyrics)            | ✅       | ✅   | None         |
| Embedding (vectors)               | ✅       | ✅   | None         |
| **Matching (core algorithm)**     | ✅       | ⬜   | **Critical** |
| **Genre enrichment**              | ✅       | ⬜   | **Required** |
| **Playlist profiling**            | ✅       | ⬜   | **Required** |
| UI                                | ✅       | 🟡   | In progress  |

---

## Critical Gap: Matching Pipeline

**Impact**: Without this, the app can analyze songs but cannot sort them into playlists.

### Missing Services (~5,400 lines total)

#### Phase 4e: Core Matching (~3,100 lines)

| File                                   | Lines | Purpose                         | Priority   |
| -------------------------------------- | ----- | ------------------------------- | ---------- |
| `matching/MatchingService.ts`          | 1493  | Multi-factor matching algorithm | 🔴 Critical |
| `matching/MatchCachingService.ts`      | 534   | Cache-first orchestration       | 🔴 Critical |
| `matching/matching-config.ts`          | 85    | Algorithm weights               | 🔴 Critical |
| `semantic/SemanticMatcher.ts`          | 306   | Theme/mood similarity           | 🔴 Critical |
| `vectorization/analysis-extractors.ts` | 354   | Text extraction for embeddings  | 🟡 Required |
| `vectorization/hashing.ts`             | 327   | Content hashing                 | 🟡 Required |

#### Phase 4f: Genre Enrichment (~1,260 lines)

| File                              | Lines | Purpose              | Priority   |
| --------------------------------- | ----- | -------------------- | ---------- |
| `lastfm/LastFmService.ts`         | 311   | Last.fm API client   | 🟡 Required |
| `lastfm/utils/genre-whitelist.ts` | 469   | 469-genre taxonomy   | 🟡 Required |
| `lastfm/utils/normalize.ts`       | 81    | Genre normalization  | 🟡 Required |
| `genre/GenreEnrichmentService.ts` | 477   | Fetch + cache genres | 🟡 Required |

#### Phase 4g: Playlist Profiling (~1,040 lines)

| File                                    | Lines | Purpose                     | Priority   |
| --------------------------------------- | ----- | --------------------------- | ---------- |
| `profiling/PlaylistProfilingService.ts` | 770   | Playlist vector computation | 🟡 Required |
| `reccobeats/ReccoBeatsService.ts`       | 226   | Audio features API          | 🟢 Optional |
| `audio/AudioFeaturesService.ts`         | 45    | Audio utilities             | 🟢 Optional |

---

## What's Already Done (v1)

### ✅ Services Ported

| Service                 | Location                        | Status     |
| ----------------------- | ------------------------------- | ---------- |
| SpotifyService          | `spotify/service.ts`            | ✅ Complete |
| LlmService              | `llm/service.ts`                | ✅ Complete |
| LyricsService           | `lyrics/service.ts`             | ✅ Complete |
| SongAnalysisService     | `analysis/song-analysis.ts`     | ✅ Complete |
| PlaylistAnalysisService | `analysis/playlist-analysis.ts` | ✅ Complete |
| AnalysisPipeline        | `analysis/pipeline.ts`          | ✅ Complete |
| DeepInfraService        | `deepinfra/service.ts`          | ✅ Complete |
| EmbeddingService        | `embedding/service.ts`          | ✅ Complete |
| RerankerService         | `reranker/service.ts`           | ✅ Complete |
| SyncOrchestrator        | `sync/orchestrator.ts`          | ✅ Complete |
| PlaylistSyncService     | `sync/playlist-sync.ts`         | ✅ Complete |
| JobLifecycleService     | `job-lifecycle.ts`              | ✅ Complete |

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
     ├─► Phase 4e: Matching Pipeline ──────────────► ⬜ NOT STARTED
     │        │
     │        └─► Phase 4g: Playlist Profiling ────► ⬜ NOT STARTED
     │
     └─► Phase 4f: Genre Enrichment ───────────────► ⬜ NOT STARTED
              │
              └─► Enhances matching quality

Phase 5: SSE ──────────────────────────────────────► ⬜ Blocked by 4g
Phase 6: Cleanup ──────────────────────────────────► ⬜ Blocked by 5
Phase 7: UI ───────────────────────────────────────► 🟡 Auth flows done
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
