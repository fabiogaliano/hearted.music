# Design Document: Matching Pipeline Services

## Context

This document captures technical decisions for porting the matching pipeline from `old_app` to `v1_hearted`. The port involves ~5,000 lines of code across 10+ service files with complex interdependencies.

**Stakeholders**: Developer (solo project)
**Constraints**:
- Must run on Cloudflare Workers (Edge Runtime)
- Must integrate with existing v1 services (EmbeddingService, RerankerService)
- Must use v1 patterns (Result types, TaggedError, data modules)

## Goals / Non-Goals

### Goals
- Port all matching pipeline services with functional parity
- Maintain algorithm accuracy (same scores for same inputs)
- Ensure Edge compatibility (no Node.js-specific APIs)
- Integrate seamlessly with existing v1 architecture

### Non-Goals
- Algorithm improvements (same logic, different implementation)
- New features beyond what's in old_app
- Performance optimizations (focus on correctness first)
- UI integration (Phase 7)

## Decisions

### 1. Web Crypto API for Hashing

**Decision**: Use Web Crypto API instead of Node.js `crypto` module.

**Rationale**: Cloudflare Workers don't support Node.js `crypto`. The Web Crypto API is available globally on the Edge.

**Implementation**:
```typescript
// Old (Node.js)
import { createHash } from 'crypto'
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

// New (Web Crypto - async)
async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
```

**Trade-off**: Hashing becomes async, which propagates through the call chain. This is acceptable since hashing is typically done during cache key computation, not in hot loops.

### 2. Data Modules Instead of Repository Pattern

**Decision**: Use existing `data/` modules instead of porting Repository classes.

**Rationale**: v1 already has data modules (`data/matching.ts`, `data/vectors.ts`, `data/song.ts`) that follow the established pattern. Porting repositories would duplicate functionality.

**Migration Map**:
| Old Repository              | v1 Data Module                            |
| --------------------------- | ----------------------------------------- |
| `TrackGenreRepository`      | `data/song.ts` (add genre functions)      |
| `PlaylistProfileRepository` | `data/vectors.ts` (add profile functions) |
| `TrackEmbeddingRepository`  | `data/vectors.ts` (already exists)        |
| `MatchContextRepository`    | `data/matching.ts` (already exists)       |
| `MatchResultRepository`     | `data/matching.ts` (already exists)       |

### 3. Optional Service Dependencies

**Decision**: Services accept optional dependencies and degrade gracefully.

**Rationale**: The matching pipeline has optional integrations (Last.fm for genres, RerankerService for Stage 2). The app should work without these, just with reduced functionality.

**Pattern**:
```typescript
export class GenreEnrichmentService {
  constructor(
    private readonly lastFmService: LastFmService | null  // null = no enrichment
  ) {}

  async enrichSong(input: GenreInput): Promise<Result<string[], GenreError>> {
    if (!this.lastFmService) {
      return Result.ok([])  // Graceful degradation
    }
    // ... actual enrichment
  }
}
```

### 4. Factory Functions for Service Instantiation

**Decision**: Each service module exports a factory function that handles env vars and dependency injection.

**Rationale**: Follows v1 pattern, keeps env var access at boundaries, facilitates testing.

**Pattern**:
```typescript
// services/lastfm/service.ts
export function createLastFmService(): LastFmService | null {
  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) {
    return null  // Service unavailable
  }
  return new LastFmService(apiKey)
}
```

### 5. Result Types for All Async Operations

**Decision**: All async service methods return `Promise<Result<T, ErrorUnion>>`.

**Rationale**: v1 pattern. Enables composition without try/catch, explicit error handling at boundaries.

**Error Hierarchy**:
```
MatchingError
├── LastFmRateLimitError
├── LastFmNotFoundError
├── LastFmApiError
├── GenreEnrichmentError
├── ProfilingError
├── SemanticMatchError
└── MatchComputationError
```

### 6. Content Hash Versioning Strategy

**Decision**: Maintain version prefixes in hashes for cache invalidation.

**Rationale**: When extraction logic or models change, old cached values should be automatically invalidated.

**Hash Formats**:
| Hash Type        | Format                 | Example              |
| ---------------- | ---------------------- | -------------------- |
| Track embedding  | `te_v{version}_{hash}` | `te_v1_a1b2c3d4e5f6` |
| Playlist profile | `pp_v{version}_{hash}` | `pp_v1_x9y8z7w6v5u4` |
| Match context    | `ctx_{hash}`           | `ctx_m1n2o3p4q5r6`   |
| Candidate set    | `cs_{hash}`            | `cs_s1t2u3v4w5x6`    |
| Playlist set     | `ps_{hash}`            | `ps_y1z2a3b4c5d6`    |

### 7. Genre Storage on Song Row

**Decision**: Store enriched genres directly on `song.genres` column (TEXT[], max 3 elements).

**Rationale**:
- Simpler than a separate `track_genre` table
- Genres are tightly coupled to songs
- Max 3 genres keeps the data compact
- Order is preserved (index 0 = primary)

**Alternative Considered**: Separate `track_genre` table with scores. Rejected because:
- Adds complexity for marginal benefit
- Scores aren't used in matching (only genre presence)
- Last.fm scores are unreliable across artists

### 8. In-Memory Caching for Hot Paths

**Decision**: Keep L1 in-memory caches for frequently accessed data.

**Rationale**: Some data is accessed multiple times per request (e.g., playlist profiles during batch matching). In-memory caching reduces DB roundtrips.

**Cache Locations**:
- `SemanticMatcher`: Embedding cache (TTL: 1 hour, max: 1000)
- `PlaylistProfilingService`: Profile cache (max: 100 playlists)

**Invalidation**: Caches are cleared on profile/embedding changes via explicit `invalidate()` methods.

### 9. Batch Operations for Efficiency

**Decision**: All services support batch operations with progress callbacks.

**Rationale**: Matching operates on hundreds of songs. Batch operations enable:
- Parallel API calls with rate limiting
- Progress reporting for UI
- Aggregated error handling

**Pattern**:
```typescript
interface BatchResult<T> {
  results: Map<string, T>
  errors: Map<string, string>
  stats: { total: number; succeeded: number; failed: number }
}

type ProgressCallback = (progress: { total: number; completed: number }) => void

async enrichBatch(
  inputs: GenreInput[],
  onProgress?: ProgressCallback
): Promise<Result<BatchResult<string[]>, GenreError>>
```

### 10. Cosine Similarity Implementation

**Decision**: Implement cosine similarity inline rather than importing a library.

**Rationale**: Avoids dependency, simple algorithm, used in multiple places.

**Implementation**:
```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dotProduct / denominator
}
```

## Risks / Trade-offs

### Risk: Async Hashing Propagation
**Impact**: Medium
**Mitigation**: Hashing is only done during cache key computation (cold path), not during scoring (hot path). Benchmark after implementation.

### Risk: Large Genre Whitelist in Memory
**Impact**: Low
**Mitigation**: 469 strings is ~10KB. Acceptable for Edge deployment.

### Risk: Matching Algorithm Drift
**Impact**: High (core business logic)
**Mitigation**:
- Port algorithm code with minimal changes
- Add determinism tests (same input → same output)
- Compare scores between old_app and v1 during testing

## Migration Plan

### Phase 1: Foundation (4f)
1. Port Last.fm service and genre whitelist
2. Port genre enrichment service
3. Add genre queries to data/song.ts
4. Test: Can enrich songs with genres

### Phase 2: Aggregation (4g)
1. Port ReccoBeats service and audio features backfill service
2. Backfill missing `song_audio_feature` rows before profiling
3. Port playlist profiling service (uses backfilled audio features)
4. Add profile queries to data/vectors.ts
5. Test: Can compute playlist profiles with audio centroids

### Phase 3: Core (4e)
1. Port text extractors and hashing
2. Port semantic matcher
3. Port matching config
4. Port matching service
5. Port caching service
6. Test: Can match songs to playlists

### Rollback
Each phase is independent. If issues arise:
- Phase 4e can be disabled (matching returns empty)
- Phase 4g can be disabled (profiles computed on-demand)
- Phase 4f can be disabled (genres remain empty)

## Open Questions

1. **Should semantic matcher use DeepInfra directly or EmbeddingService?**
   - EmbeddingService handles caching and storage
   - For short strings (themes, moods), storage may be overkill
   - Decision: Use DeepInfra directly for semantic matching when `DEEPINFRA_API_KEY` is set (prod).
   - When the key is missing (local), skip embedding calls and rely on lexical matches only.

2. **How to handle playlist profile invalidation on song changes?**
   - Songs can be added/removed from playlists
   - Profile depends on song embeddings and genres
   - Decision: Content hash includes song IDs. Hash changes → profile invalidates. Explicit `invalidateProfile()` method for manual invalidation.
