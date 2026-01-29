# Hearted

**The stories inside your Liked Songs.**

---

Your Liked Songs collection is a graveyard of good intentions. Hundreds of tracks, maybe thousands, accumulating in an infinite scroll you never revisit.

Hearted analyzes that collection and matches songs to your existing playlists using AI—based on lyrics, mood, and audio characteristics. 

## What It Does

Hearted connects to Spotify, reads your library, and runs each Liked Song through a multi-signal analysis pipeline:

- **Lyrics analysis** — LLM interprets themes, emotions, and narrative arc
- **Audio features** — Energy, tempo, danceability, valence, acousticness
- **Semantic matching** — Vector embeddings compare song characteristics against playlist signatures


## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (React)                          │
│                    TanStack Start + Router                      │
│              ┌──────────────────────────────┐                   │
│              │   Authenticated Route Tree   │                   │
│              │  /onboarding  /dashboard     │                   │
│              └──────────────────────────────┘                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                      Server Functions                           │
│              (createServerFn, SSR, API routes)                  │
│         ┌─────────────────────────────────┐                     │
│         │   SSE Progress Streaming        │                     │
│         │   /api/jobs/{id}/progress       │                     │
│         └─────────────────────────────────┘                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   Supabase    │ │  Spotify API  │ │  LLM Provider │
│  (Postgres)   │ │ (OAuth/App)   │ │               │
└───────────────┘ └───────────────┘ └───────────────┘
        │                                   │
        │         ┌───────────────┐         │
        │         │    Genius     │         │
        │         │   (Lyrics)    │         │
        │         └───────────────┘         │
        │                 │                 │
        ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Matching Pipeline                            │
│  Sync → Enrich (lyrics, audio) → Analyze → Match → Commit      │
└─────────────────────────────────────────────────────────────────┘
```

## The Matching Pipeline

### Stage 1: Sync
Pull user's Liked Songs and playlists from Spotify. Tracks stored in Supabase with Spotify metadata.

### Stage 2: Enrich
- **Lyrics**: Fetched via Genius API search + scraping
- **Audio features**: Retrieved from ReccoBeats (Spotify deprecated their audio features endpoint)

### Stage 3: Analyze
LLM processes each song:
- Extracts mood, themes, energy level from lyrics
- Generates semantic tags
- Produces embedding-ready descriptors

### Stage 4: Match
Vector similarity comparison between song analysis and playlist signatures. Each playlist builds a "vibe profile" from its existing tracks.

### Stage 5: Commit
User reviews matches, confirms or rejects, songs added to Spotify playlists via API.


## Tech Stack

| Layer      | Technology         | Notes                                  |
| ---------- | ------------------ | -------------------------------------- |
| Runtime    | Bun                | Fast JS runtime + package manager      |
| Framework  | TanStack Start     | Full-stack React with SSR              |
| Routing    | TanStack Router    | File-based, type-safe + Zod validation |
| Database   | Supabase           | Postgres + Row Level Security          |
| Auth       | Custom             | Spotify OAuth, session tokens          |
| Styling    | Tailwind CSS       | CSS variable theming                   |
| Realtime   | SSE                | Server-Sent Events for job progress    |
| Deployment | Cloudflare Workers | Edge runtime                           |
| Testing    | Vitest             | Unit + integration                     |
| Linting    | Biome              | Fast, opinionated                      |

### External Services

| Service            | Purpose                                  |
| ------------------ | ---------------------------------------- |
| Spotify Web API    | OAuth, library sync, playlist management |
| Genius             | Lyrics search and retrieval              |
| ReccoBeats         | Audio features (energy, tempo, etc.)     |
| Google AI / OpenAI | LLM analysis (user-provided key)         |
| DeepInfra          | Embeddings generation                    |

## Project Structure

```
src/
├── routes/                  # File-based routing (TanStack Router)
│   ├── __root.tsx           # Root layout
│   ├── index.tsx            # Landing page
│   ├── _authenticated/      # Protected route tree
│   │   ├── route.tsx        # Auth guard layout
│   │   ├── onboarding.tsx   # Multi-step onboarding
│   │   └── dashboard.tsx    # Main app
│   ├── auth/                # OAuth flows
│   │   └── spotify/         # Spotify OAuth callback
│   └── api/                 # API endpoints
│       └── jobs/$id/        # Job progress SSE
├── features/                # Feature modules
│   ├── onboarding/          # Onboarding wizard
│   │   ├── components/      # Step components
│   │   └── hooks/           # Navigation, scroll behavior
│   ├── landing/             # Marketing landing page
│   └── matching/            # Match review UI
├── components/ui/           # Design system primitives
├── lib/                     # Core utilities
│   ├── capabilities/        # Business logic
│   │   ├── sync/            # Spotify sync orchestration
│   │   ├── matching/        # Analysis pipeline
│   │   └── profiling/       # Playlist signatures
│   ├── integrations/        # External service clients
│   │   └── spotify/         # Spotify SDK wrapper
│   ├── jobs/progress/       # SSE progress system
│   ├── theme/               # Color theme system
│   ├── data/                # Database operations
│   └── server/              # Server functions
└── styles/                  # Global styles

docs/                        # Architecture decisions
openspec/                    # Feature specifications
supabase/migrations/         # Database migrations
```

## Getting Started

### Prerequisites

- Bun 1.0+
- Spotify Developer App ([developer.spotify.com](https://developer.spotify.com))
- Supabase Project ([supabase.com](https://supabase.com))

### Installation

```bash
git clone <repo>
cd v1_hearted
bun install
```

### Environment Configuration

```bash
cp .env.example .env
```

Required variables:

```bash
# Spotify OAuth
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/auth/callback/spotify

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Genius (lyrics)
GENIUS_ACCESS_TOKEN=your_genius_token

# Optional: Default LLM for development
GOOGLE_AI_API_KEY=your_google_ai_key
```

### Database Setup

```bash
# Run migrations
bunx supabase db push

# Generate types
bun run gen:types
```

### Development

```bash
bun dev
```

Runs at `http://localhost:5173` with HMR.

### Production Build

```bash
bun run build
bun run preview  # Test production build locally
```

## Scripts

| Command             | Description              |
| ------------------- | ------------------------ |
| `bun dev`           | Start development server |
| `bun run build`     | Production build         |
| `bun run preview`   | Preview production build |
| `bun run test`      | Run test suite           |
| `bun run lint`      | Lint with Biome          |
| `bun run format`    | Format with Biome        |
| `bun run check`     | Lint + format check      |
| `bun run typecheck` | TypeScript type checking |

## Design System

Typography-driven, editorial aesthetic:

- **Display**: Instrument Serif (Google Fonts)
- **Body**: Geist (Vercel)
- **Palette**: Monochromatic HSL themes (12-32% saturation)
- **Themes**: Warm (rose, default), Calm (blue), Fresh (green), Dreamy (lavender)

## Future Ideas

- [ ] **Listener Profile** — Aggregated emotional/thematic profile from your library
- [ ] **Musical Timeline** — Chronological visualization of taste evolution with auto-detected "life chapters"
- [ ] **Theme Clusters** — Visual clustering by meaning, not genre
- [ ] **Insight Cards** — Shareable, social-media-ready cards for viral moments
- [ ] **Taste Compatibility** — Compare profiles with friends or partners
- [ ] **Last.fm Integration** — Import loved tracks as additional signal
- [ ] **Cross-Platform Matching** — ISRC-based matching for Apple Music, Tidal, Deezer
- [ ] **Multi-Service Accounts** — Connect multiple streaming services per user
- [ ] **Playlist Auto-Sync** — Automatically re-sort when new songs are liked
- [ ] **Smart Playlist Creation** — Generate new playlists from detected patterns
- [ ] **Contextual Playlists** — Auto-generated playlists based on time, season, mood
- [ ] **Musical Memory Lane** — Annotate songs with personal memories and life events

## Documentation

| Document                       | Description                          |
| ------------------------------ | ------------------------------------ |
| `docs/migration_v2/ROADMAP.md` | Migration status and phases          |
| `docs/DATA-FLOW-PATTERNS.md`   | Data fetching conventions            |
| `docs/ONBOARDING-FLOW.md`      | User onboarding design               |
| `src/routes/README.md`         | Route organization and file patterns |
| `openspec/project.md`          | Project overview and goals           |

## Contributing

Personal project. Issues and discussions welcome.

## License

MIT
