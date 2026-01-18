# Tasks: Port Phase 4 Service Layer

## 1. Factory Removal
- [x] 1.1 Delete factory files (N/A - v1 is a fresh port, no factories exist)
- [x] 1.2 Update imports to use direct service modules (N/A - using direct imports from start)

## 2. Analysis Pipeline
- [x] 2.1 Create `analysis/pipeline.ts` orchestrator (merge batch + prefetch + progress)
- [x] 2.2 Create `SongAnalysisService` using `data/analysis.ts`
- [x] 2.3 Create `PlaylistAnalysisService` using `data/analysis.ts`
- [x] 2.4 Wire job progress updates via `data/jobs.ts`

## 3. Playlist Sync Services
- [x] 3.1 Create `PlaylistSyncService` for Spotify API sync operations
- [x] 3.2 Create `SyncOrchestrator` to coordinate liked songs + playlists sync
- [x] 3.3 `PlaylistService` DB ops now in `data/playlists.ts` (Phase 3)
- [x] 3.4 `UserService` replaced by `data/accounts.ts` (Phase 3)

## 4. DeepInfra Migration
- [x] 4.1 Create `DeepInfraService` (embeddings + reranking) at `services/deepinfra/service.ts`
- [x] 4.2 Create `EmbeddingService` using DeepInfraService at `services/embedding/service.ts`
- [x] 4.3 Create `RerankerService` using DeepInfraService at `services/reranker/service.ts`

## 5. Validation & Docs
- [x] 5.1 Run `bun run typecheck` - new services pass (old_app has separate legacy issues)
- [x] 5.2 Update `docs/migration_v2/ROADMAP.md` for Phase 4 completion

## Files Created

```
src/lib/services/
├── analysis/
│   ├── pipeline.ts          # Batch analysis orchestrator with job tracking
│   ├── song-analysis.ts     # LLM song analysis with Zod schemas
│   └── playlist-analysis.ts # LLM playlist analysis with Zod schemas
├── deepinfra/
│   └── service.ts           # DeepInfra API client (embeddings + reranking)
├── embedding/
│   └── service.ts           # Song embedding generation with caching
├── llm/
│   └── service.ts           # AI SDK integration (Google/Anthropic/OpenAI)
├── reranker/
│   └── service.ts           # Cross-encoder reranking for match refinement
└── sync/
    ├── playlist-sync.ts     # Playlist Spotify API sync
    └── orchestrator.ts      # Full sync coordinator (liked songs + playlists)

src/lib/errors/
└── service.ts               # Service-layer error types (DeepInfraError, LlmError, etc.)
```

## Notes

- All services use `Result<T, Error>` from `better-result` for composable error handling
- No barrel exports (index.ts files) - use direct imports
- Services delegate to `data/` modules for DB operations
- Sync services accept `SpotifyService` via constructor injection
