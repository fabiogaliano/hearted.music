# Hearted

**The stories inside your Liked Songs.**

---

Your Liked Songs collection is a graveyard of good intentions. Hundreds of tracks, maybe thousands, accumulating in an infinite scroll you never revisit.

hearted. analyzes that collection and matches songs to your existing playlists using AI — based on lyrics, mood, and audio characteristics.

---

## What It Does

hearted. uses a Chrome extension to read your Spotify library (the extension intercepts Spotify's own internal session). Each Liked Song runs through a multi-signal enrichment pipeline, then gets matched against your playlists using a combination of:

- **Lyrics analysis** — LLM interprets themes, emotions, and narrative arc
- **Audio features** — Energy, tempo, danceability, valence, acousticness (via ReccoBeats)
- **Genre tagging** — Last.fm genre signals
- **Semantic embeddings** — Dense vectors compare song characteristics against playlist vibe profiles

You then review the proposed matches and accept or reject each one. Accepted matches are written back to Spotify via the extension.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     Browser / Chrome                           │
│                                                                │
│  ┌──────────────────────────┐   ┌───────────────────────────┐  │
│  │   hearted. Web App       │   │   Chrome Extension        │  │
│  │  (TanStack Start SSR)    │   │   (Manifest V3)           │  │
│  │                          │   │                           │  │
│  │  React 19 + Router       │◄──│  content scripts          │  │
│  │  TanStack Query          │   │  background service worker│  │
│  │  Better Auth client      │   │  popup (React)            │  │
│  └──────────┬───────────────┘   └──────────┬────────────────┘  │
└─────────────│──────────────────────────────│───────────────────┘
              │  HTTPS (session cookie        │  chrome.runtime.sendMessage
              │  or Bearer token)             │  POST /api/extension/sync
              ▼                               ▼
┌────────────────────────────────────────────────────────────────┐
│                Cloudflare Workers (SSR)                        │
│                                                                │
│  TanStack Start server functions + HTTP handlers               │
│  Better Auth  ·  Supabase admin client                         │
│  Library-processing state machine                              │
│  Job lifecycle (create / start / complete / sweep)             │
└──────────────────────────────┬─────────────────────────────────┘
                               │ Postgres (Supabase + pgvector)
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                  Background Worker (Bun)                       │
│                                                                │
│  Polls `job` table  ·  Health HTTP server                      │
│  Enrichment pipeline chunks                                    │
│  Match snapshot refresh                                        │
└────────────────────────────────────────────────────────────────┘
```

---

## The Chrome Extension

The extension replaces the Spotify Web API. Spotify deprecated audio features and no longer supports meaningful third-party library access. Instead of OAuth → Spotify REST, the extension:

1. Runs a content script on `open.spotify.com` to intercept and capture Spotify's internal session token
2. Uses that token to call Spotify's internal API directly — fetching liked songs, playlists, and playlist tracks
3. Pushes the full library snapshot to `POST /api/extension/sync` 
4. Receives write-back commands from the web app (`addToPlaylist`, `createPlaylist`, etc.) and forwards them to Spotify's internal mutation API

---

## The Matching Pipeline

```
Extension sync (POST /api/extension/sync)
         │
         │  Writes liked_song, playlist, playlist_song rows
         │  Creates phase jobs (sync_liked_songs, sync_playlists, sync_playlist_tracks)
         ▼
Library-processing state machine
         │  Reconciles change facts, emits effects
         │
    ┌────┴──────────────────────────────────────┐
    ▼                                           ▼
Enrichment job                       Match Snapshot Refresh job
(background worker)                  (background worker, after enrichment)
    │                                           │
    │  Phase A (parallel):                      │  1. target_song_enrichment (optional)
    │    audio_features — ReccoBeats API        │  2. playlist_profiling
    │    genre_tagging  — Last.fm API           │     centroid embedding, genre dist.,
    │                                           │     audio centroid per target playlist
    │  Phase B:                                 │  3. candidate_loading
    │    song_analysis — LLM                    │     all fully-enriched liked songs
    │    (headline, mood, themes,               │  4. matching
    │     interpretation, sonic texture)        │     vector similarity + audio features
    │                                           │     + genre overlap → weighted score
    │  Phase C:                                 │     optional cross-encoder reranking
    │    song_embedding — instruction-tuned     │  5. publishing
    │    embedding model → pgvector             │     writes match_result rows
    ▼                                           ▼
                                Match Review UI (/match)
                                         │
                                User accepts / rejects
                                         │
                                Accepted → extension write-back
                                (SPOTIFY_COMMAND addToPlaylist)
```

### Enrichment stages

| Stage            | Source          | Produces                                          |
| ---------------- | --------------- | ------------------------------------------------- |
| `audio_features` | ReccoBeats API  | energy, valence, danceability, acousticness, etc. |
| `genre_tagging`  | Last.fm API     | genre tags (normalised against a curated list)    |
| `song_analysis`  | LLM (AI SDK)    | headline, mood, themes, interpretation, journey   |
| `song_embedding` | Embedding model | dense vector stored in pgvector                   |

### Scoring

```
score = w_embed · cosine_similarity(song_vec, playlist_centroid)
      + w_audio · audio_feature_distance(song, playlist_centroid)
      + w_genre · weighted_genre_overlap(song, playlist_distribution)
```

Weights adapt based on which data is actually available for each candidate song. Scores are clamped to `[0, 1]`. An optional cross-encoder reranker (DeepInfra) can refine the final ranking.

---

## Tech Stack

### Application

| Layer              | Technology                                    |
| ------------------ | --------------------------------------------- |
| Runtime            | Bun                                           |
| Framework          | TanStack Start (SSR + server functions)       |
| Routing            | TanStack Router (file-based, type-safe + Zod) |
| Data fetching      | TanStack Query v5                             |
| UI                 | React 19                                      |
| Styling            | Tailwind CSS v4                               |
| Animation          | GSAP · Framer Motion                          |
| Auth               | Better Auth (Google OAuth)                    |
| Auth DB ORM        | Drizzle ORM + postgres.js (auth schema only)  |
| App DB             | Supabase JS client (all other data)           |
| Database           | Supabase — Postgres + pgvector                |
| Validation         | Zod v4                                        |
| Error handling     | `better-result` (typed Result values)         |
| Deployment         | Cloudflare Workers (Wrangler)                 |
| Worker runtime     | Bun (separate process, Docker)                |
| Testing            | Vitest + Testing Library                      |
| Linting            | Biome                                         |
| Component workshop | Ladle                                         |

### External services

| Service          | Purpose                                                  |
| ---------------- | -------------------------------------------------------- |
| Chrome Extension | Library sync + Spotify write-back (replaces Spotify API) |
| ReccoBeats API   | Audio features (free; Spotify deprecated their endpoint) |
| Last.fm API      | Genre tagging                                            |
| Genius           | Lyrics fetching (search + HTML scraping)                 |
| LLM (AI SDK)     | Song analysis — Anthropic Claude, Google Gemini, OpenAI  |
| DeepInfra        | Embedding generation + optional cross-encoder reranking  |
| HuggingFace      | Embedding generation (alternative provider)              |
| Supabase         | Postgres + pgvector + Row Level Security                 |
| Resend           | Transactional email (waitlist confirmation)              |
| Google OAuth     | User authentication (via Better Auth)                    |

---

## Project Structure

```
v1_hearted/
├── src/
│   ├── routes/          # TanStack Router file-based routes
│   │   ├── __root.tsx
│   │   ├── index.tsx    # Landing page
│   │   ├── _authenticated/  # Auth-guarded shell + sidebar
│   │   ├── api/extension/   # Extension API (sync, status, token)
│   │   ├── api/auth/        # Better Auth catch-all
│   │   └── auth/logout.tsx
│   │
│   ├── features/        # Feature-sliced UI
│   │   ├── dashboard/
│   │   ├── landing/
│   │   ├── liked-songs/
│   │   ├── matching/
│   │   ├── onboarding/
│   │   └── playlists/
│   │
│   ├── lib/
│   │   ├── platform/    # Auth (Better Auth), job lifecycle
│   │   ├── domains/     # Pure domain logic
│   │   │   ├── enrichment/  (audio-features, content-analysis, embeddings, lyrics)
│   │   │   ├── library/     (accounts, artists, liked-songs, playlists, songs)
│   │   │   └── taste/       (playlist-profiling, song-matching)
│   │   ├── workflows/   # Multi-step orchestration
│   │   │   ├── enrichment-pipeline/
│   │   │   ├── library-processing/
│   │   │   ├── match-snapshot-refresh/
│   │   │   └── spotify-sync/
│   │   ├── integrations/ # External service adapters
│   │   │   ├── providers/   (embedding provider factory: deepinfra / huggingface / local)
│   │   │   ├── llm/         (AI SDK multi-provider wrapper)
│   │   │   ├── reccobeats/
│   │   │   ├── lastfm/
│   │   │   └── reranker/
│   │   ├── server/      # TanStack Start server functions
│   │   ├── data/        # Supabase query helpers, generated DB types
│   │   ├── extension/   # Extension detection, Spotify command client
│   │   └── theme/       # Per-account hue theming
│   │
│   ├── components/      # Shared UI primitives
│   ├── worker/          # Background worker (Bun process)
│   └── stories/         # Ladle story fixtures
│
├── extension/           # Chrome extension (separate build)
│   └── src/
│       ├── background/  # Service worker (command routing, sync)
│       ├── content/     # Content scripts (token interception)
│       ├── popup/       # React popup UI
│       └── shared/      # Spotify Pathfinder client, storage
│
├── shared/              # Code shared between app and extension
│   └── spotify-command-protocol.ts
│
├── docs/                # Architecture docs and specs
├── openspec/            # Feature specifications
├── scripts/             # Dev/ops utility scripts
└── supabase/migrations/ # Database migrations
```

---

## Getting Started

### Prerequisites

- Bun 1.0+
- Supabase project ([supabase.com](https://supabase.com))
- Google OAuth app (for sign-in)
- Chrome extension installed and connected (for library sync)

### Installation

```bash
git clone <repo>
cd v1_hearted
bun install
```

### Environment

```bash
cp .env.example .env
```

Required:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Better Auth
BETTER_AUTH_SECRET=at_least_32_chars
BETTER_AUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:password@localhost:54322/postgres

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

Optional (pipeline degrades gracefully without these):

```env
# Enrichment
LASTFM_API_KEY=           # genre tagging
GENIUS_CLIENT_TOKEN=      # lyrics

# Embeddings — choose one provider
ML_PROVIDER=local         # local transformers.js (default for dev)
DEEPINFRA_API_KEY=        # DeepInfra (recommended for prod)
HF_TOKEN=                 # HuggingFace Inference API

# LLM (song analysis — at least one recommended)
# AI SDK reads provider keys from env automatically:
# ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY

# Email
RESEND_API_KEY=           # waitlist confirmation emails

# Extension
VITE_CHROME_EXTENSION_ID= # Chrome extension ID for externally_connectable messaging
```

### Database

```bash
# Apply migrations
bunx supabase db push

# Generate TypeScript types from schema
bun run gen:types
```

### Development

```bash
# Web app (with local embedding sidecar)
bun run dev

# Background worker (separate terminal)
bun run dev:worker

# Local embedding sidecar (only needed with ML_PROVIDER=local)
bun run dev:embeddings

# Extension (watch mode)
bun run ext:dev
```

---

## Scripts

| Command                            | Description                                            |
| ---------------------------------- | ------------------------------------------------------ |
| `bun run dev`                      | Dev server (`ML_PROVIDER=local`)                       |
| `bun run dev:ui`                   | Dev server without devtools overlay                    |
| `bun run dev:worker`               | Background worker                                      |
| `bun run dev:embeddings`           | Local embedding sidecar                                |
| `bun run build`                    | Production Vite build                                  |
| `bun run preview`                  | Preview production build locally                       |
| `bun run deploy`                   | Build + `wrangler deploy`                              |
| `bun run deploy:secrets:waitlist`  | Push env vars as Wrangler secrets (waitlist mode)      |
| `bun run deploy:secrets:released`  | Push env vars as Wrangler secrets (released mode)      |
| `bun run test`                     | Vitest (unit + integration)                            |
| `bun run typecheck`                | `tsc --noEmit`                                         |
| `bun run check`                    | Biome lint + format check                              |
| `bun run lint`                     | Biome lint                                             |
| `bun run format`                   | Biome format                                           |
| `bun run gen:types`                | Regenerate DB types from local Supabase schema         |
| `bun run ladle`                    | Component workshop                                     |
| `bun run fixtures`                 | Rebuild Ladle story fixtures from DB snapshots         |
| `bun run lyrics:snapshot`          | Generate lyrics parser snapshots                       |
| `bun run lyrics:validate`          | Run lyrics integration tests against snapshots         |
| `bun run ext:build`                | Build Chrome extension (production)                    |
| `bun run ext:dev`                  | Build Chrome extension (watch)                         |
| `bun run ext:store`                | Build Chrome extension for Chrome Web Store submission |
| `bun run reset:onboarding <email>` | Reset onboarding for a dev/test account (see below)    |

### `reset:onboarding`

Warm reset by default — clears workflow state without touching the synced library:

```bash
bun run reset:onboarding user@example.com
bun run reset:onboarding --account-id <uuid>
bun run reset:onboarding --spotify-id <spotify-user-id>

# Optional flags for a colder reset:
# --wipe-library      also delete liked songs + playlists
# --clear-api-token   also revoke the extension API token
```

---

## Design System

Typography-driven, editorial aesthetic:

- **Display**: Instrument Serif
- **Body**: Geist
- **Palette**: Monochromatic HSL — per-account hue theming (12–32% saturation)
- **Themes**: Warm (rose, default) · Calm (blue) · Fresh (green) · Dreamy (lavender)

---

## Documentation

| Path                       | Contents                                                                  |
| -------------------------- | ------------------------------------------------------------------------- |
| `src/routes/README.md`     | Routes layout, architecture, matching pipeline, full tech stack reference |
| `docs/library-processing/` | Library-processing state machine design                                   |
| `docs/brand/`              | Brand voice, copy guide, positioning                                      |
| `openspec/specs/`          | Feature specifications                                                    |
| `supabase/migrations/`     | Database migration history                                                |

---

## License

MIT
