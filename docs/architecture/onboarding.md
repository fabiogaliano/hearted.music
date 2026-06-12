# Onboarding Architecture

Canonical reference for the walkthrough onboarding system. Covers types, modules,
component contracts, and step→route mapping.

---

## Step Sequence

```
welcome → pick-color → install-extension → syncing → claim-handle
→ flag-playlists → pick-demo-song
→ song-walkthrough  (/liked-songs, walkthrough mode)
→ match-walkthrough (/match, walkthrough mode)
→ plan-selection → complete
```

`complete` is not a saveable step — completion is recorded via `onboarding_completed_at`,
not `onboarding_step`. All other steps are writable via `saveOnboardingStep`.

> **`claim-handle` note:** The `claim_handle` RPC hardcodes the "claim-handle and later"
> subset in its not-ready gate. Adding/renaming/reordering steps requires a migration to
> re-create the RPC — `onboarding-steps.test.ts` has a tripwire that fails if they drift.

---

## Core Types

### `OnboardingSession` (discriminated union)

`src/lib/domains/library/accounts/onboarding-session.ts`

```ts
type OnboardingSession =
  | { status: "welcome" }
  | { status: "pick-color" }
  | { status: "install-extension" }
  | { status: "syncing" }
  | { status: "claim-handle" }
  | { status: "flag-playlists" }
  | { status: "pick-demo-song" }
  | { status: "song-walkthrough"; song: WalkthroughSong }
  | { status: "match-walkthrough"; song: WalkthroughSong }
  | { status: "plan-selection" }
  | { status: "complete" };
```

Walkthrough variants carry their song inline — the type system forbids
`{ status: "song-walkthrough", song: null }`. Illegal states are unrepresentable;
preconditions live in the type rather than scattered runtime guards.

### `OnboardingMode`

Broad UI categorization derived from the session. Not stored anywhere — always computed.

```ts
type OnboardingMode = "steps" | "walkthrough" | "complete";

sessionMode(session: OnboardingSession): OnboardingMode
```

| Mode | When | Sidebar | Route |
|------|------|---------|-------|
| `"complete"` | `status === "complete"` | Visible | Any |
| `"walkthrough"` | `status === "song-walkthrough" \| "match-walkthrough"` | Hidden | `/liked-songs`, `/match` |
| `"steps"` | All other steps | Hidden | `/onboarding` |

### `WalkthroughSong`

`src/lib/domains/library/accounts/onboarding-session.ts`

```ts
type WalkthroughSong = {
  id: string;
  spotifyTrackId: string;
  slug: string;
  name: string;
  artist: string;
  artistId: string | null;
  artistImageUrl: string | null;
  album: string | null;
  albumArtUrl: string | null;
  genres: string[];
  analysis: WalkthroughSongAnalysis | null;  // pre-fetched so panel renders immediately
};

type WalkthroughSongAnalysis = {
  id: string;
  content: AnalysisContent;
  model: string;
  createdAt: string | null;
};
```

### `OnboardingStep` / `SaveableOnboardingStep`

`src/lib/domains/library/accounts/onboarding-steps.ts`

`SaveableOnboardingStep` excludes `"complete"` (completion is recorded via timestamp).
Helpers: `compareOnboardingSteps`, `isOnboardingStepBefore`, `clearsSyncPhaseJobIds`.

---

## Modules

### `step-resolver.ts`

`src/features/onboarding/step-resolver.ts`

```ts
type AllowedPath = "/onboarding" | "/liked-songs" | "/match" | "/dashboard";

function resolveSession(session: OnboardingSession): { allowedPath: AllowedPath }
function isPathAllowed(pathname: string, allowedPath: AllowedPath): boolean
```

Step → route mapping:

| `session.status` | `allowedPath` |
|------------------|---------------|
| `song-walkthrough` | `/liked-songs` |
| `match-walkthrough` | `/match` |
| `complete` | `/dashboard` |
| All others | `/onboarding` |

`resolveSession` takes the full session DU (not just the step string) because walkthrough
variants need no separate precondition checks — the DU already guarantees the song is present.

### `useStepNavigation()`

`src/features/onboarding/hooks/useStepNavigation.ts`

```ts
const { navigateTo, isPending } = useStepNavigation();

navigateTo(step: SaveableOnboardingStep): Promise<void>
```

Flow: save step to DB → fetch authoritative session (`fetchQuery`, not `setQueryData`) →
resolve route → navigate. On failure: error toast, no navigation.

Used for cross-surface transitions (`/onboarding` ↔ `/liked-songs` ↔ `/match`).
Not used by standard `/onboarding` steps — those use `useOnboardingNavigation()`.

### `useOnboardingNavigation()`

`src/features/onboarding/hooks/useOnboardingNavigation.ts`

Scoped to `/onboarding`. Uses search-param-based step navigation. Not for walkthrough
surface transitions.

---

## Route Context

`_authenticated/route.tsx` exposes `onboardingSession: OnboardingSession` in route context.
Consumer pattern:

```ts
const { onboardingSession } = Route.useRouteContext();
const mode = sessionMode(onboardingSession);

// Narrow to get the song in walkthrough steps:
const song = onboardingSession.status === "song-walkthrough"
  ? onboardingSession.song
  : null;
```

Query key: `ONBOARDING_SESSION_QUERY_KEY = ["auth", "onboarding-session"]`
(`src/lib/platform/auth/query-keys.ts`)

---

## Component Contracts

### `SongCard`

```ts
interface SongCardProps {
  isEnabled?: boolean;           // default true
  isWalkthroughHighlight?: boolean; // default false
}
```

`isEnabled={false}`: `opacity-50`, `pointer-events-none`, no hover states.
`isWalkthroughHighlight={true}`: left border + pulsing box-shadow; reduced-motion → static border only.

### `SongDetailPanel`

```ts
interface SongDetailPanelProps {
  isWalkthrough?: boolean; // default false
}
```

`isWalkthrough={true}`: hides `PlaylistsSection`, appends sticky CTA "See where this song belongs →".

### `LikedSongsPage`

```ts
interface LikedSongsPageProps {
  onboardingSession?: OnboardingSession;
}
```

Derives walkthrough state internally: `status === "song-walkthrough"` → spotlight mode
(demo song interactive at top, real songs dimmed, infinite scroll disabled, keyboard nav
limited to demo song).

---

## UI Copy

| Location | Copy |
|----------|------|
| Song detail panel CTA | `"See where this song belongs →"` |
| Plan selection success CTA | `"Start Exploring →"` |
