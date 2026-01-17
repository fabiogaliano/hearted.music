# Migration v2 Roadmap

> Product board for tracking migration progress. Each phase has clear tasks, references, and acceptance criteria.

---

## Status Overview

| Phase | Name | Status | Blocked By |
|-------|------|--------|------------|
| 0 | Foundation | ✅ Complete | — |
| 1 | Schema | 🟡 Partial (core tables) | Phase 0 |
| 2 | Extensions | 🟡 Partial (types done) | Phase 1 |
| 3 | Query Modules | 🟡 In Progress | Phase 2 |
| 4a | Delete Factories | ⬜ Not Started | Phase 3 |
| 4b | Song/Analysis Services | ⬜ Not Started | Phase 3 |
| 4c | Playlist/Sync Services | ⬜ Not Started | Phase 3 |
| 4d | DeepInfra Migration | ⬜ Not Started | Phase 3 |
| 5 | SSE | ⬜ Not Started | Phase 4* |
| 6 | Cleanup | ⬜ Not Started | Phase 5 |
| 7 | UI Integration | 🟡 In Progress (auth flows) | Phase 6 |

---

## Phase 0: Foundation

> Set up infrastructure for v2 development.

### Tasks

- [x] **Create Supabase Cloud project**
  - Go to [supabase.com](https://supabase.com) → New Project
  - Name: `spotify-v2` (or similar)
  - Region: Choose closest
  - Save URL + keys

- [x] **Configure environment**
  - Add to `.env.local`:
    ```
    SUPABASE_URL=https://xxx.supabase.co
    SUPABASE_ANON_KEY=xxx
    SUPABASE_SERVICE_ROLE_KEY=xxx
    ```
  - Ref: [Decision #052](/docs/architecture/migration_v2/00-DECISIONS.md)

- [ ] **Set up DB keep-alive**
  - Create cron job to ping Supabase every 5 days
  - Prevents free tier pause
  - Options: GitHub Action, cron-job.org, or Cloudflare Worker

- [x] **Verify local Supabase**
  ```bash
  supabase status  # Should show running
  supabase db reset  # Fresh start
  ```

### Acceptance Criteria
- [x] Can connect to Supabase Cloud from app
- [x] Local Supabase running with empty DB
- [ ] Keep-alive scheduled

### References
- [00-DECISIONS.md #052](/docs/architecture/migration_v2/00-DECISIONS.md) — Supabase Cloud Free

---

## Phase 1: Schema

> Create all 17 tables with RLS policies.

### Tasks

#### Tier 1: No Dependencies
- [ ] `001_create_account.sql` — [Decision #001, #039](/docs/architecture/migration_v2/00-DECISIONS.md)
- [ ] `002_create_song.sql` — [Decision #002, #040, #041, #042](/docs/architecture/migration_v2/00-DECISIONS.md)

#### Tier 2: Depends on Tier 1
- [ ] `003_create_song_audio_feature.sql`
- [ ] `004_create_song_analysis.sql`
- [ ] `005_create_song_embedding.sql`
- [ ] `006_create_song_genre.sql`
- [ ] `007_create_liked_song.sql` — [Decision #005, #043](/docs/architecture/migration_v2/00-DECISIONS.md)
- [ ] `008_create_playlist.sql` — [Decision #006](/docs/architecture/migration_v2/00-DECISIONS.md)
- [ ] `009_create_job.sql` — [Decision #008, #009](/docs/architecture/migration_v2/00-DECISIONS.md)

#### Tier 3: Depends on Tier 2
- [ ] `010_create_playlist_song.sql` — [Decision #049](/docs/architecture/migration_v2/00-DECISIONS.md) (RLS subquery)
- [ ] `011_create_playlist_analysis.sql`
- [ ] `012_create_playlist_profile.sql`
- [ ] `013_create_job_failure.sql`
- [ ] `014_create_match_context.sql`
- [ ] `015_create_item_status.sql` — [Decision #010](/docs/architecture/migration_v2/00-DECISIONS.md)
- [ ] `016_create_user_preferences.sql` — [Decision #044, #045, #046](/docs/architecture/migration_v2/00-DECISIONS.md)

#### Tier 4: Final
- [ ] `017_create_match_result.sql`

### Acceptance Criteria
- [ ] All 17 tables created
- [ ] RLS enabled on all tables
- [ ] Foreign keys valid
- [ ] `supabase db reset` runs clean

### References
- [01-SCHEMA.md](/docs/architecture/migration_v2/01-SCHEMA.md) — Full schema definitions
- [03-IMPLEMENTATION.md Phase 1](/docs/architecture/migration_v2/03-IMPLEMENTATION.md) — SQL for each migration

---

## Phase 2: Extensions & Types

> Enable pgvector and generate TypeScript types.

### Tasks

- [ ] **Enable pgvector extension**
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```

- [ ] **Generate TypeScript types**
  ```bash
  supabase gen types typescript --local > lib/database.types.ts
  ```

- [ ] **Create Zod/Valibot schemas**
  - Location: `lib/schemas/`
  - One file per domain: `song.schema.ts`, `playlist.schema.ts`, etc.
  - Ref: [Decision #036, #037](/docs/architecture/migration_v2/00-DECISIONS.md)

### Acceptance Criteria
- [ ] pgvector queries work (test with dummy vector)
- [ ] TypeScript types compile
- [ ] Schemas validate sample data

### References
- [01-SCHEMA.md](/docs/architecture/migration_v2/01-SCHEMA.md) — Type definitions
- [Decision #021](/docs/architecture/migration_v2/00-DECISIONS.md) — Valibot for validation

---

## Phase 3: Query Modules

> Create 9 data access modules replacing repositories.

### Tasks

- [x] `data/client.ts` — Supabase client setup
- [x] `data/songs.ts` — [02-SERVICES.md](/docs/architecture/migration_v2/02-SERVICES.md)
- [x] `data/playlists.ts`
- [ ] `data/analysis.ts`
- [ ] `data/vectors.ts`
- [ ] `data/matching.ts`
- [x] `data/jobs.ts`
- [x] `data/accounts.ts`
- [ ] `data/newness.ts` — NEW for `item_status`
- [ ] `data/preferences.ts` — NEW for `user_preferences`
- [x] `data/auth-tokens.ts` — (additional) Token refresh support

### Acceptance Criteria
- [ ] Each module compiles
- [ ] Each module has working CRUD functions
- [ ] Old repositories can delegate to new modules (facade pattern)

### References
- [02-SERVICES.md Query Modules](/docs/architecture/migration_v2/02-SERVICES.md) — Function signatures
- [Decision #030, #031, #032](/docs/architecture/migration_v2/00-DECISIONS.md) — Query module pattern

---

## Phase 4a: Delete Factories

> Remove factory pattern files.

### Tasks

- [ ] Delete `matching/factory.ts`
- [ ] Delete `reranker/factory.ts`
- [ ] Delete `embedding/factory.ts`
- [ ] Delete `genre/factory.ts`
- [ ] Delete `profiling/factory.ts`
- [ ] Delete `llm/LlmProviderManagerFactory.ts`
- [ ] Update imports to use direct imports

### Acceptance Criteria
- [ ] No factory files remain
- [ ] All imports updated
- [ ] `bun run typecheck` passes

### References
- [Decision #034](/docs/architecture/migration_v2/00-DECISIONS.md) — No factories

---

## Phase 4b: Song/Analysis Services

> Consolidate song and analysis pipeline.

### Tasks

- [ ] Merge analysis pipeline → `analysis/pipeline.ts`
  - From: `TrackPrefetchService`, `PlaylistBatchProcessor`, `ProgressNotifier`
  - To: Single orchestrator
- [ ] Delete `TrackService.ts` → use `data/songs.ts`
- [ ] Update `SongAnalysisService` to use query modules
- [ ] Update `PlaylistAnalysisService` to use query modules

### Acceptance Criteria
- [ ] Song sync works
- [ ] Analysis pipeline works
- [ ] No duplicate code

### References
- [02-SERVICES.md](/docs/architecture/migration_v2/02-SERVICES.md) — Service consolidation
- [Decision #033](/docs/architecture/migration_v2/00-DECISIONS.md) — Merge analysis pipeline

---

## Phase 4c: Playlist/Sync Services

> Split and consolidate playlist services.

### Tasks

- [ ] Create `PlaylistSyncService.ts` (Spotify API operations)
- [ ] Update `PlaylistService.ts` → use `data/playlists.ts` for DB
- [ ] Rename `SyncService.ts` → `SyncOrchestrator.ts`
- [ ] Delete `UserService.ts` → use `data/accounts.ts`

### Acceptance Criteria
- [ ] Playlist sync works
- [ ] No duplicate DB code

### References
- [02-SERVICES.md](/docs/architecture/migration_v2/02-SERVICES.md) — PlaylistSyncService spec

---

## Phase 4d: DeepInfra Migration

> Replace Python vectorization with DeepInfra API.

### Tasks

- [ ] **Create DeepInfraService**
  - Location: `lib/services/deepinfra/DeepInfraService.ts`
  - Endpoints:
    - Embeddings: `https://api.deepinfra.com/v1/openai/embeddings`
    - Reranker: `https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-0.6B`

- [ ] **Add environment variable**
  ```
  DEEPINFRA_API_KEY=xxx
  ```

- [ ] **Update EmbeddingService** → call DeepInfra
- [ ] **Update RerankerService** → call DeepInfra
- [ ] **Remove sentiment calls** (LLM handles emotions)
- [ ] **Delete VectorizationService.ts**
- [ ] **Delete `services/vectorization/` Python folder**
- [ ] **Update docker-compose.yml** — remove vectorization service

### Acceptance Criteria
- [ ] Embeddings return 1024-dim vectors
- [ ] Existing embeddings still compatible (no reindexing)
- [ ] Reranking works
- [ ] No Python service running

### References
- [02-SERVICES.md DeepInfraService](/docs/architecture/migration_v2/02-SERVICES.md) — Service spec
- [Decision #053, #054, #055, #056](/docs/architecture/migration_v2/00-DECISIONS.md) — DeepInfra decisions

---

## Phase 5: SSE Migration

> Replace WebSocket job subscriptions with Server-Sent Events.

### Tasks

- [ ] Create SSE endpoint: `routes/api/jobs/$id/progress.tsx`
  ```typescript
  import { createAPIFileRoute } from '@tanstack/start/api'

  export const Route = createAPIFileRoute('/api/jobs/$id/progress')({
    GET: async ({ request, params }) => {
      // SSE stream implementation
    }
  })
  ```
- [ ] Update job creation to emit SSE events
- [ ] Delete `JobSubscriptionManager.ts`
- [ ] Delete `JobPersistenceService.ts` → use `data/jobs.ts`
- [ ] Update UI to use EventSource

### Acceptance Criteria
- [ ] Job progress streams via SSE
- [ ] No WebSocket code remains
- [ ] Works in Cloudflare Workers (no WS support)

### References
- [02-SERVICES.md SSE API Route](/docs/architecture/migration_v2/02-SERVICES.md)
- [Decision #035](/docs/architecture/migration_v2/00-DECISIONS.md) — SSE over WebSocket

---

## Phase 6: Cleanup & Smoke Tests

> Final cleanup and validation.

### Tasks

#### Cleanup
- [ ] Delete `vectorization/VectorCache.ts`
- [ ] Delete `llm/ProviderKeyService.ts`
- [ ] Delete old repository files
- [ ] Update `services/index.ts` exports
- [ ] Remove unused dependencies from `package.json`

#### Smoke Tests
- [ ] **Auth flow**: Login → account created → redirect
- [ ] **Song sync**: Trigger → job created → songs appear
- [ ] **Playlist sync**: Trigger → playlists appear → mark destination
- [ ] **Analysis**: Run → progress updates → saved
- [ ] **Matching**: Run → results appear → can review
- [ ] **Newness**: New songs badge → viewing clears

### Acceptance Criteria
- [ ] `bun run typecheck` clean
- [ ] `bun run lint` clean
- [ ] `bun run build` succeeds
- [ ] All smoke tests pass

---

## Phase 7: UI Integration

> Connect new data layer to UI with TanStack Start.

### Tasks

- [ ] Initialize TanStack Start project
  ```bash
  bun create @tanstack/router@latest
  ```
- [ ] Set up route structure
  ```
  routes/
  ├── __root.tsx        # Root layout with providers
  ├── index.tsx         # Landing
  ├── _app.tsx          # Authenticated layout
  └── _app/
      ├── index.tsx     # Home
      ├── sort.tsx      # Matching
      └── library/
  ```
- [ ] Configure TanStack Query in root layout
- [ ] Set up Zustand stores
- [ ] Create server functions (`lib/server/*.ts`)
- [ ] Create query hooks (`lib/queries/*.ts`)
- [ ] Implement SSE subscription hook
- [ ] Build first route using `createFileRoute`
- [ ] Implement onboarding flow with `user_preferences`

### Acceptance Criteria
- [ ] UI renders with real data
- [ ] Onboarding saves theme preference
- [ ] Job progress shows in real-time

### References
- [Decision #036](/docs/architecture/migration_v2/00-DECISIONS.md) — TanStack Start server functions
- [ONBOARDING-FLOW.md](/docs/architecture/ONBOARDING-FLOW.md) — Onboarding spec
- [DATA-FLOW-PATTERNS.md](/docs/architecture/DATA-FLOW-PATTERNS.md) — Data patterns

---

## Deployment

> After all phases complete.

### Tasks

- [ ] **Cloudflare Workers setup**
  - Follow: [RR7 Cloudflare Guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)
  - `bunx wrangler init`
  - Configure `wrangler.toml`

- [ ] **Environment variables in Cloudflare**
  ```
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  DEEPINFRA_API_KEY
  SPOTIFY_CLIENT_ID
  SPOTIFY_CLIENT_SECRET
  ```

- [ ] **Deploy**
  ```bash
  bun run build
  wrangler deploy
  ```

- [ ] **Custom domain** (optional)

### References
- [Decision #051](/docs/architecture/migration_v2/00-DECISIONS.md) — Cloudflare Workers

---

## Quick Links

| Doc | Purpose |
|-----|---------|
| [00-DECISIONS.md](./00-DECISIONS.md) | All 56 architectural decisions |
| [01-SCHEMA.md](./01-SCHEMA.md) | Database schema definitions |
| [02-SERVICES.md](./02-SERVICES.md) | Service layer consolidation |
| [03-IMPLEMENTATION.md](./03-IMPLEMENTATION.md) | Detailed SQL + code |

---

*Last updated: January 2026*
