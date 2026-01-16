# Onboarding Flow Design

> First-time user experience that leads to the "aha moment"

---

## Current State Analysis

### Current Flow
```
1. Welcome screen (explains app)
2. API Key setup (forces LLM key entry)
3. Preferences (batch size, sync mode)
4. → Redirect to dashboard
```

### Problems with Current

| Issue | Impact |
|-------|--------|
| API key upfront is friction | Users bounce before seeing value |
| No playlist flagging | User doesn't know what to do next |
| No automatic sync | User has to figure out next step |
| No preview of value | User doesn't see the "magic" |
| Preferences too early | User doesn't know what they mean |

---

## Design Principles

### 1. Value Before Configuration
Show the magic before asking for setup.

### 2. Progressive Commitment
Small asks → bigger asks as trust builds.

### 3. Immediate Feedback
Something happens right away.

### 4. Guided Not Blocked
Suggest, don't force.

---

## New Onboarding Flow

### Overview

```
Landing → Login → Sync → Flag Playlists → First Match → Dashboard
   │         │       │         │              │            │
   └─ See   └─ One  └─ Auto   └─ Choose    └─ See      └─ Full
      value    click    start    targets      magic        access
```

### Step-by-Step Design

---

### Step 1: Landing Page (Pre-Login)

**Goal**: Show value, build trust, get login

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ╭─────────────────────────────────────────────────────────────────────────╮│
│  │  🎵  hearted.                                              [Connect Spotify]││
│  ╰─────────────────────────────────────────────────────────────────────────╯│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                                                                          ││
│  │            the stories inside your Liked Songs                           ││
│  │                                                                          ││
│  │   [Visual: Song analysis panel with themes/meaning]                      ││
│  │                                                                          ││
│  │   Every ♡ was a feeling.                                                ││
│  │   What do they say about you?                                           ││
│  │                                                                          ││
│  │                    [Show me mine]                                        ││
│  │                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  "Already organized 50,000+ songs for 1,200+ users"  (social proof)        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key elements**:
- One clear CTA: "Show me mine"
- Visual: Song analysis panel showing themes/meaning
- Self-discovery hook: "What do they say about you?"
- Social proof (if available)
- No mention of API keys or configuration

---

### Step 2: Spotify OAuth

**Goal**: Authenticate with minimal friction

Standard Spotify OAuth flow. User sees Spotify's permission screen.

---

### Step 3: Syncing (Automatic)

**Goal**: Show progress, build anticipation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                        Setting up your music library...                      │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                                                                          ││
│  │    ✓ Connected to Spotify                                               ││
│  │    ✓ Found 847 liked songs                                              ││
│  │    → Syncing 23 playlists...  ████████░░░░░░░░░░░░  12/23               ││
│  │                                                                          ││
│  │    ┌────────────────────────────────────────────────────────────────┐   ││
│  │    │  🎵 Workout Energy        47 tracks                             │   ││
│  │    │  🌙 Chill Vibes           32 tracks                             │   ││
│  │    │  🎸 Rock Classics         89 tracks                             │   ││
│  │    │  🎉 Party Mix             56 tracks                             │   ││
│  │    │  ...                                                            │   ││
│  │    └────────────────────────────────────────────────────────────────┘   ││
│  │                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  💡 While we sync, we'll need your help picking which playlists to         │
│     organize songs into...                                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key elements**:
- Starts automatically (no button to click)
- Shows real progress
- Previews their actual playlists
- Primes for next step (playlist selection)

---

### Step 4: Flag Playlists (Interactive)

**Goal**: Get user to choose target playlists

This is the CRITICAL step - without flagged playlists, matching doesn't work.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                    Which playlists should we organize into?                  │
│                                                                              │
│  Select the playlists where you want your liked songs sorted.               │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                                                                          ││
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         ││
│  │  │ ☐ Workout       │  │ ☑ Chill Vibes   │  │ ☑ Party Mix     │         ││
│  │  │    Energy       │  │                  │  │                  │         ││
│  │  │    47 tracks    │  │    32 tracks     │  │    56 tracks     │         ││
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         ││
│  │                                                                          ││
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         ││
│  │  │ ☐ Rock          │  │ ☐ Focus Music   │  │ ☐ Summer 2024   │         ││
│  │  │    Classics     │  │                  │  │                  │         ││
│  │  │    89 tracks    │  │    28 tracks     │  │    15 tracks     │         ││
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         ││
│  │                                                                          ││
│  │                         ... show more (17 more)                          ││
│  │                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  💡 Pick playlists that have a clear theme or mood.                         │
│     "Workout Energy" ✓   "My Playlist #3" ✗                                 │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  2 playlists selected                      [Continue with 2 playlists]  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key elements**:
- Cards for each playlist (visual)
- Checkboxes for selection
- Hint about what makes a good target playlist
- Must select at least 1 to continue
- Can skip with "(Skip for now)" link

---

### Step 5: First Match Preview (The "Aha!" Moment)

**Goal**: Show the magic before asking for API key

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                        Here's how it works...                                │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                                                                          ││
│  │   Let's match one of your songs to see the magic.                       ││
│  │                                                                          ││
│  │   ┌─────────────────────────────────────────────────────────────────┐   ││
│  │   │  🎵 "Blinding Lights" - The Weeknd                              │   ││
│  │   │                                                                  │   ││
│  │   │  [Analyzing with AI...]  ████████░░░░                           │   ││
│  │   │                                                                  │   ││
│  │   │  ✓ Mood: Energetic, Nostalgic                                  │   ││
│  │   │  ✓ Genre: Synth-pop, Dance                                     │   ││
│  │   │  ✓ Themes: Night, Love, Euphoria                               │   ││
│  │   │                                                                  │   ││
│  │   │  Best match: 🎵 Workout Energy  (94% match)                    │   ││
│  │   │              "High energy, upbeat tempo"                        │   ││
│  │   │                                                                  │   ││
│  │   │                              [Add to Playlist]                  │   ││
│  │   └─────────────────────────────────────────────────────────────────┘   ││
│  │                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  To analyze more songs, you'll need an AI key (it's free!)                  │
│                                                                              │
│                         [Set up AI key]   [Skip for now]                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key elements**:
- Uses a FREE demo analysis (we pay for 1)
- Shows the actual matching working
- User sees their real playlist as a match
- THEN asks for API key (after value proven)
- Skip option available

---

### Step 6: API Key Setup (Optional)

**Goal**: Get API key, but don't block

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                         Set up AI analysis                                   │
│                                                                              │
│  To analyze your full library, connect an AI provider.                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                                                                          ││
│  │   Recommended: Google AI (Free tier available)                          ││
│  │                                                                          ││
│  │   1. Go to aistudio.google.com                                          ││
│  │   2. Create an API key (free)                                           ││
│  │   3. Paste it below                                                     ││
│  │                                                                          ││
│  │   ┌────────────────────────────────────────────────────────────────┐   ││
│  │   │ API Key:  [••••••••••••••••••••••••]   [Validate]              │   ││
│  │   └────────────────────────────────────────────────────────────────┘   ││
│  │                                                                          ││
│  │   ✓ Your key is valid!                                                  ││
│  │                                                                          ││
│  │   [Continue to Dashboard]                                               ││
│  │                                                                          ││
│  │   ─────────────────────────────────────────────────────────────────     ││
│  │                                                                          ││
│  │   Other providers: [OpenAI] [Anthropic]                                 ││
│  │                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│                     [Skip for now - I'll add later]                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key elements**:
- Google recommended (free tier)
- Step-by-step instructions
- Immediate validation feedback
- Skip option (user can still browse, just can't analyze)

---

### Step 7: Dashboard (Done!)

User lands on dashboard with:
- Playlists already flagged
- Sync complete
- Ready to analyze (if API key provided)
- Or prompted to add API key

---

## State Machine

```
LANDING
  │
  └─▶ LOGIN (oauth)
       │
       └─▶ SYNCING
            │ automatic
            ▼
         FLAG_PLAYLISTS
            │ must select ≥1 or skip
            ▼
         FIRST_MATCH
            │ show demo analysis
            ▼
         API_KEY_SETUP
            │ optional
            ▼
         DASHBOARD
```

---

## Data Model Changes

```sql
-- Track onboarding progress
ALTER TABLE users
ADD COLUMN onboarding_step TEXT DEFAULT 'landing'
CHECK (onboarding_step IN ('landing', 'syncing', 'flag_playlists', 'first_match', 'api_key', 'complete'));

-- Track if user saw the demo
ALTER TABLE users
ADD COLUMN demo_track_id INTEGER REFERENCES tracks(id);
```

---

## Resumable Onboarding

If user leaves mid-onboarding:
- Syncing: Resume where left off
- Flag playlists: Show selection screen again
- First match: Skip to dashboard
- API key: Can add later from settings

---

## Metrics to Track

| Metric | What It Tells Us |
|--------|------------------|
| Login rate | Is landing page compelling? |
| Sync completion | Any technical issues? |
| Playlists flagged count | Do users understand the concept? |
| Demo match engagement | Does the "aha" work? |
| API key setup rate | Is the friction worth it? |
| Time to first real match | How fast do users get value? |

---

## Skip Handling

| Step | Skip Behavior |
|------|---------------|
| Flag playlists | Go to dashboard, show reminder banner |
| First match | Go directly to API key setup |
| API key | Go to dashboard, show "Add API key to analyze" prompt |

---

## Mobile Considerations

- Sync screen works on mobile (progress is vertical)
- Playlist grid becomes 2 columns on mobile
- Demo match is full-width card
- API key entry is standard input

---

## Implementation Notes

### TanStack Start Route Structure
```
routes/
├── index.tsx              → Landing (public)
├── onboarding.tsx         → Onboarding shell (handles all steps)
└── _app/
    └── index.tsx          → Main app (post-onboarding)
```

### Route Definition
```typescript
// routes/onboarding.tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { zodValidator, fallback } from '@tanstack/zod-adapter'
import { z } from 'zod'

// Search params for step state (survives refresh)
// Using fallback() ensures invalid values don't crash the app
const OnboardingSearchSchema = z.object({
  step: fallback(
    z.enum(['syncing', 'flag_playlists', 'first_match', 'api_key']),
    undefined
  ).optional(),
})

// Server function to check onboarding status
// This runs ONLY on server, but can be called from isomorphic loader
const getOnboardingData = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await requireUserSession()
    const preferences = await preferencesRepository.getOrCreate(session.userId)

    // If already completed, redirect to app
    if (preferences.onboarding_step === 'complete') {
      throw redirect({ to: '/app' })
    }

    // Parallel fetch with allSettled for resilience
    const results = await Promise.allSettled([
      playlistRepository.getPlaylists(session.userId),
      newnessRepository.getNewCount(session.userId, 'song'),
    ])

    return {
      step: preferences.onboarding_step,
      playlists: results[0].status === 'fulfilled' ? results[0].value : [],
      newSongsCount: results[1].status === 'fulfilled' ? results[1].value : 0,
    }
  })

export const Route = createFileRoute('/onboarding')({
  validateSearch: zodValidator(OnboardingSearchSchema),  // ← Wrap with zodValidator!
  loader: () => getOnboardingData(),
  component: OnboardingPage,
})

function OnboardingPage() {
  const { step, playlists, newSongsCount } = Route.useLoaderData()
  const { step: urlStep } = Route.useSearch()

  // Use URL step if provided, otherwise use DB step
  const currentStep = urlStep ?? step

  return (
    <OnboardingShell step={currentStep}>
      {currentStep === 'syncing' && <SyncingStep />}
      {currentStep === 'flag_playlists' && <FlagPlaylistsStep playlists={playlists} />}
      {currentStep === 'first_match' && <FirstMatchStep />}
      {currentStep === 'api_key' && <ApiKeyStep />}
    </OnboardingShell>
  )
}
```

### State Management
```typescript
// Onboarding state via search params + server state
type OnboardingState = {
  step: 'syncing' | 'flag_playlists' | 'first_match' | 'api_key'
  syncProgress: { songs: number; playlists: number }
  flaggedPlaylistIds: number[]
  demoTrackId?: number
  apiKeyValid: boolean
}

// Navigate between steps
import { useNavigate } from '@tanstack/react-router'

const navigate = useNavigate()
navigate({
  to: '/onboarding',
  search: { step: 'flag_playlists' }
})
```

### Server Functions for Step Actions
```typescript
// Flag playlists server function
export const flagPlaylistsFn = createServerFn({ method: 'POST' })
  .validator(z.object({ playlistIds: z.array(z.string()) }))
  .handler(async ({ data }) => {
    const session = await requireUserSession()

    await playlistRepository.setDestinationPlaylists(
      session.userId,
      data.playlistIds
    )

    // Update onboarding step
    await preferencesRepository.updateOnboardingStep(
      session.userId,
      'first_match'
    )

    return { success: true }
  })
```

### Component Structure
```
features/onboarding/
├── OnboardingShell.tsx       ← Container with step logic
├── steps/
│   ├── SyncingStep.tsx
│   ├── FlagPlaylistsStep.tsx
│   ├── FirstMatchStep.tsx
│   └── ApiKeyStep.tsx
├── components/
│   ├── PlaylistCard.tsx
│   ├── ProgressIndicator.tsx
│   └── DemoMatchCard.tsx
└── hooks/
    └── useOnboardingProgress.ts  ← SSE hook for sync progress
```
