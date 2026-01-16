# Lessons Learned: Code Archaeology

> Documenting specific anti-patterns found in the current codebase to avoid repeating them.

---

## Anti-Pattern 1: The N+1 Query Problem

**Location**: `matching.loader.server.ts:36-57, 101-113`

```typescript
// ❌ CURRENT: Fetching analyses one-by-one in a loop
for (const playlist of flaggedPlaylists) {
  try {
    const analysis = await playlistAnalysisRepository.getAnalysisByPlaylistId(playlist.id)
    playlists.push({ ...playlist, analysis: analysis?.analysis || null } as AnalyzedPlaylist)
  } catch (analysisError) {
    // ...swallow error
  }
}

// Same pattern for tracks (101-113)
for (const trackId of trackIds) {
  const analysis = await trackAnalysisRepository.getByTrackId(trackId)
  // ...
}
```

**Problem**:
- If user has 100 playlists and 500 tracks, this makes 600+ database queries
- Each `await` serializes the requests - no parallelism
- Error swallowing hides real problems

**Solution**:
```typescript
// ✅ BETTER: Batch queries with proper error handling
const analyses = await playlistAnalysisRepository.getByPlaylistIds(playlistIds)
const analysisMap = new Map(analyses.map(a => [a.playlist_id, a]))

const playlists = flaggedPlaylists.map(p => ({
  ...p,
  analysis: analysisMap.get(p.id)?.analysis ?? null
}))
```

---

## Anti-Pattern 2: The Giant Component

**Location**: `MatchingPage.tsx` (489 lines)

```typescript
// ❌ CURRENT: One component doing everything
export default function MatchingPage({ playlists, tracks }: MatchingPageProps) {
  // 5 useState hooks
  const [selectedPlaylist, setSelectedPlaylist] = useState(null)
  const [matchResults, setMatchResults] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isMatching, setIsMatching] = useState(false)
  const [error, setError] = useState(null)

  // 4 async functions doing API calls
  const handlePlaylistSelect = async () => { ... }
  const triggerPlaylistAnalysis = async () => { ... }
  const performMatching = async () => { ... }
  const addSongToPlaylist = async () => { ... }

  // 4 utility functions
  const getScoreColor = () => { ... }
  const formatScore = () => { ... }
  const getScoreBgColor = () => { ... }

  // 260+ lines of JSX
  return ( ... )
}
```

**Problems**:
- Can't reuse any logic independently
- Testing requires mocking everything
- Hard to find what you're looking for
- State updates scattered everywhere
- No separation of concerns

**Solution**:
```typescript
// ✅ BETTER: Compose smaller, focused pieces

// hooks/useMatching.ts - All matching logic
export function useMatching(playlistId: number | null) {
  const { data, mutate } = useMatchMutation()
  return { matches: data, runMatch: mutate }
}

// hooks/usePlaylistAnalysis.ts - Analysis logic
export function usePlaylistAnalysis(playlistId: number) {
  return useMutation({ mutationFn: () => api.playlists.analyze(playlistId) })
}

// components/MatchResultCard.tsx - Just display
export function MatchResultCard({ match, onAdd }: Props) {
  return ( /* 30 lines of focused UI */ )
}

// components/PlaylistSelector.tsx - Just selection
export function PlaylistSelector({ playlists, selected, onSelect }: Props) {
  return ( /* 40 lines of selection UI */ )
}

// pages/Matching.tsx - Composition only
export function MatchingPage() {
  const { playlists } = usePlaylists()
  const [selected, setSelected] = useState<number | null>(null)
  const { matches } = useMatching(selected)

  return (
    <Layout>
      <PlaylistSelector playlists={playlists} selected={selected} onSelect={setSelected} />
      {matches.map(m => <MatchResultCard key={m.id} match={m} onAdd={handleAdd} />)}
    </Layout>
  )
}
```

---

## Anti-Pattern 3: Manual Type Assertions

**Location**: `matching.loader.server.ts:44, 55, 122`

```typescript
// ❌ CURRENT: Type assertions to force types
playlists.push({
  ...playlist,
  description: playlist.description || undefined,
  analysis: analysis?.analysis || null,
} as AnalyzedPlaylist)  // 👈 Forcing the type

// And again...
return {
  ...track,
  analysis: analysis?.analysis || null,
} as AnalyzedTrack  // 👈 Forcing the type
```

**Problems**:
- TypeScript can't verify correctness
- If shape changes, no compile error
- Hiding actual type mismatches

**Solution**:
```typescript
// ✅ BETTER: Functions that return validated types

function toAnalyzedPlaylist(
  playlist: Playlist,
  analysis: PlaylistAnalysis | null
): AnalyzedPlaylist {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description ?? undefined,
    track_count: playlist.track_count,
    is_flagged: playlist.is_flagged,
    analysis: analysis?.analysis ?? null,
  }
}

// Now TypeScript will error if shape is wrong
const playlists = flaggedPlaylists.map(p =>
  toAnalyzedPlaylist(p, analysisMap.get(p.id) ?? null)
)
```

---

## Anti-Pattern 4: Mixed Data Fetching Strategies

**Location**: `MatchingPage.tsx:74-93, 96-169`

```typescript
// ❌ CURRENT: Manual fetch() inside component
const response = await fetch(apiRoutes.playlists.analysis(playlist.id.toString()), {
  method: 'POST',
})
// No type safety on response
const data: MatchingResults = await response.json()  // Trust and pray
```

**Meanwhile**: Uses `useQueryClient` but doesn't use React Query for mutations:
```typescript
const queryClient = useQueryClient()  // Has React Query...
// ...but then manual fetches everywhere
```

**Problems**:
- No caching
- No automatic refetching
- No error boundaries
- No optimistic updates
- Response type not validated

**Solution**:
```typescript
// ✅ BETTER: Consistent React Query usage

// api/matching.api.ts
export const matchingApi = {
  runMatch: async (playlistId: number, trackIds: number[]) => {
    const res = await fetch('/api/match', {
      method: 'POST',
      body: JSON.stringify({ playlistId, trackIds })
    })
    return MatchResultsSchema.parse(await res.json())  // Validated!
  }
}

// hooks/useMatching.ts
export function useRunMatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: matchingApi.runMatch,
    onSuccess: (data, { playlistId }) => {
      queryClient.setQueryData(['matches', playlistId], data)
    }
  })
}
```

---

## Anti-Pattern 5: Local Interface Definitions

**Location**: `MatchingPage.tsx:10-35`

```typescript
// ❌ CURRENT: Interfaces defined locally
interface PlaylistCardData {
  id: number
  name: string
  description?: string
  track_count: number
  is_flagged: boolean
  hasAnalysis: boolean
  analysis?: any  // 👈 `any` sneaks in
}

interface MatchedSong {
  id: number
  name: string
  artist: string
  similarity: number
  component_scores: any  // 👈 `any` again
  veto_applied?: boolean
  veto_reason?: string
}
```

**Problems**:
- Duplicates domain models
- Drifts from actual API response shape
- Can't be reused
- `any` types hide real structure

**Solution**:
```typescript
// ✅ BETTER: Single source of truth

// lib/models/Matching.ts - Shared domain model
export interface MatchResult {
  trackId: number
  playlistId: number
  similarity: number
  componentScores: {
    semantic: number
    emotional: number
    audio: number
    genre: number
  }
  vetoApplied: boolean
  vetoReason?: string
}

// lib/schemas/matching.schema.ts - Validation
export const MatchResultSchema = v.object({
  trackId: v.number(),
  playlistId: v.number(),
  similarity: v.number(),
  componentScores: v.object({
    semantic: v.number(),
    emotional: v.number(),
    audio: v.number(),
    genre: v.number(),
  }),
  vetoApplied: v.boolean(),
  vetoReason: v.optional(v.string()),
})

export type MatchResult = v.InferOutput<typeof MatchResultSchema>
```

---

## Anti-Pattern 6: Error Swallowing

**Location**: `matching.loader.server.ts:155-167`

```typescript
// ❌ CURRENT: Catch-all that hides errors
} catch (error) {
  if (error instanceof Response) {
    throw error
  }
  logger.error({ err: error }, 'Error in matching loader')
  // Return empty data on error to show the "no data" message
  return {
    playlists: [] as AnalyzedPlaylist[],
    tracks: [] as AnalyzedTrack[],
  }
}
```

**Problems**:
- User sees "no data" but doesn't know why
- Can't distinguish "no data" from "error occurred"
- Hides bugs in production
- Makes debugging harder

**Solution**:
```typescript
// ✅ BETTER: Explicit error states

type LoaderResult =
  | { status: 'success'; data: MatchingLoaderData }
  | { status: 'error'; error: { code: string; message: string } }
  | { status: 'empty'; reason: 'no_tracks' | 'no_playlists' }

// In loader
if (!flaggedPlaylists.length) {
  return { status: 'empty', reason: 'no_playlists' }
}

// In component
if (data.status === 'error') {
  return <ErrorState code={data.error.code} message={data.error.message} />
}
if (data.status === 'empty') {
  return <EmptyState reason={data.reason} />
}
```

---

## Anti-Pattern 7: Hardcoded UI Logic

**Location**: `MatchingPage.tsx:208-224`

```typescript
// ❌ CURRENT: Styling logic in component
const getScoreColor = (score: number): string => {
  if (score >= 0.7) return 'text-green-600 dark:text-green-400'
  if (score >= 0.5) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

const getScoreBgColor = (score: number): string => {
  if (score >= 0.7) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  // ...
}
```

**Problems**:
- Duplicated across components
- Not part of design system
- Magic numbers (0.7, 0.5) not configurable
- Can't be tested independently

**Solution**:
```typescript
// ✅ BETTER: Design system utilities

// lib/design/score-colors.ts
export const SCORE_THRESHOLDS = {
  high: 0.7,
  medium: 0.5,
  low: 0,
} as const

export function getScoreLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= SCORE_THRESHOLDS.high) return 'high'
  if (score >= SCORE_THRESHOLDS.medium) return 'medium'
  return 'low'
}

// components/ui/ScoreBadge.tsx
const variants = {
  high: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  low: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

export function ScoreBadge({ score }: { score: number }) {
  const level = getScoreLevel(score)
  return (
    <span className={cn('rounded-full px-2 py-1 text-xs font-medium', variants[level])}>
      {formatPercent(score)}
    </span>
  )
}
```

---

## Anti-Pattern 8: Props vs Loader Data Mismatch

**Location**: `MatchingPage.tsx:41-44`

```typescript
// ❌ CURRENT: Defensive guards because types aren't trustworthy
export default function MatchingPage({ playlists, tracks }: MatchingPageProps) {
  // Safety guards for data
  const safePlaylists = Array.isArray(playlists) ? playlists : []
  const safeTracks = Array.isArray(tracks) ? tracks : []
```

**The fact that we need "safety guards" tells us something is wrong.**

**Problems**:
- Types say `AnalyzedPlaylist[]` but we don't trust them
- Defensive code adds noise
- Hides actual bugs (why might data be undefined?)

**Solution**:
```typescript
// ✅ BETTER: Validate at boundary, trust internally

// At API layer
const data = MatchingDataSchema.parse(await response.json())
// Now TypeScript knows it's valid

// In component - no guards needed
export default function MatchingPage({ playlists, tracks }: MatchingPageProps) {
  // playlists is guaranteed to be AnalyzedPlaylist[] by the time it gets here
  return playlists.map(p => <PlaylistCard key={p.id} playlist={p} />)
}
```

---

## Summary: The Core Issues

| Anti-Pattern | Root Cause | Impact |
|--------------|------------|--------|
| N+1 queries | No batch thinking | Performance |
| Giant components | No composition | Maintainability |
| Type assertions | Avoiding proper modeling | Type safety |
| Mixed fetching | No clear strategy | Consistency |
| Local interfaces | No shared types | Duplication |
| Error swallowing | Short-term thinking | Debugging |
| Hardcoded UI logic | No design system | Consistency |
| Defensive guards | Untrusted types | Code noise |

## The Pattern to Follow

```
┌─────────────────────────────────────────────────────────────────┐
│                     THE CLEAN ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. VALIDATE at boundaries (API responses, form data, params)  │
│                          ↓                                       │
│  2. TRANSFORM to domain models (functions, not assertions)      │
│                          ↓                                       │
│  3. CACHE in query layer (React Query)                          │
│                          ↓                                       │
│  4. COMPOSE small components (one job each)                     │
│                          ↓                                       │
│  5. STYLE via design system (no hardcoded colors/sizes)         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```
