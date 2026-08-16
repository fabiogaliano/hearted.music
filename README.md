# Hearted

**The stories inside your Liked Songs.**

---

Your Liked Songs collection is a graveyard of good intentions. Hundreds of tracks, maybe thousands, accumulating in an infinite scroll you never revisit.

hearted. reads that collection and does two things with it: matches songs into playlists you already have, and builds new playlists out of it.

---

## What It Does

A Chrome/Firefox extension reads your Spotify library (it intercepts Spotify's own internal session rather than using the public Web API). Each Liked Song runs through a multi-signal enrichment pipeline:

| Signal              | Source                          |
| ------------------- | ------------------------------- |
| Lyrics analysis     | LLM — themes, mood, narrative   |
| Audio features      | ReccoBeats (energy, valence, …) |
| Genre tags          | Last.fm, normalised             |
| Semantic embeddings | Qwen3 → pgvector                |

Those signals drive two surfaces:

**Match Review** (`/match`) — songs are scored against your existing playlists and proposed one at a time. You accept or reject each. Accepted matches are written back to Spotify through the extension.

**Playlist Studio** (`/playlists/new`) — build a *new* playlist from your liked songs. Pick genres and filters, set a size, and get a live preview plus a suggestions tray. With enough unlocked songs you can also describe the playlist in natural language and the intent is embedded into the query. Publishing commits the draft to Spotify as a static snapshot.

Matching itself is deterministic — a weighted score over embedding similarity, audio-feature distance, and genre overlap, with an optional cross-encoder rerank on the top candidates. The LLM interprets lyrics; it does not pick the matches.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        Browser                                    │
│                                                                   │
│  ┌──────────────────────────┐   ┌─────────────────────────────┐   │
│  │   hearted. Web App       │   │   Extension (MV3)           │   │
│  │  (TanStack Start SSR)    │   │   Chromium + Firefox        │   │
│  │                          │◄──│                             │   │
│  │  React 19 + Router       │   │  content scripts            │   │
│  │  TanStack Query          │   │  background service worker  │   │
│  │  Better Auth client      │   │  popup (React, accounts UI) │   │
│  └──────────┬───────────────┘   └──────────┬──────────────────┘   │
└─────────────│──────────────────────────────│──────────────────────┘
              │  HTTPS (session cookie       │  POST /api/extension/sync
              │  or Bearer token)            │  SPOTIFY_COMMAND write-back
              ▼                              ▼
┌───────────────────────────────────────────────────────────────────┐
│              Cloudflare Workers (SSR, Smart Placement)            │
│                                                                   │
│  TanStack Start server functions + HTTP handlers                  │
│  Better Auth  ·  Supabase admin client  ·  Stripe billing bridge  │
│  Library-processing state machine                                 │
│  Job lifecycle (create / start / complete / sweep)                │
└──────────────────────────────┬────────────────────────────────────┘
                               │ Postgres + pgvector
                               │ (self-hosted Supabase, Coolify VPS)
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                  Background Worker (Bun, Docker)                  │
│                                                                   │
│  Concurrent poll loops, each with its own claim RPC:              │
│    library jobs · extension sync · match deck · account events    │
│    audio-feature backfill (prod only)                             │
│                                                                   │
│  LISTEN/NOTIFY wake-ups · stale-lease sweep · scheduled backups   │
│  Health HTTP server · Sentry + PostHog instrumentation            │
└───────────────────────────────────────────────────────────────────┘
```

The account-events gateway runs as a separate entrypoint (`gateway-entry.ts`) so event
publishing survives worker restarts independently.

Smart Placement puts the Worker near the VPS Postgres, which is where deck reads spend
most of their round trip.

---

## The Extension

Spotify deprecated audio features and no longer supports meaningful third-party library
access, so the extension replaces the Spotify Web API entirely:

1. A content script on `open.spotify.com` intercepts Spotify's internal session token
2. That token calls Spotify's internal Pathfinder API — liked songs, playlists, playlist tracks
3. The library snapshot is pushed to `POST /api/extension/sync`
4. Write-back commands (`addToPlaylist`, `createPlaylist`) arrive from the web app and are forwarded to Spotify's internal mutation API

The popup surfaces both connected accounts — Spotify and hearted. — with independent
disconnect and reconnect actions. Ships for Chromium and Firefox from one source tree
(`extensions/`, separate manifests).

---

## The Pipeline

```
Extension sync (POST /api/extension/sync)
         │  Writes liked_song, playlist, playlist_song rows
         │  Creates phase jobs
         ▼
Library-processing state machine
         │  Reconciles change facts, emits effects
    ┌────┴──────────────────────────────────────┐
    ▼                                           ▼
Enrichment                            Match Snapshot Refresh
    │                                           │
    │  Phase A (parallel):                      │  1. playlist_profiling
    │    audio_features — ReccoBeats            │     centroid embedding, genre dist.,
    │    genre_tagging  — Last.fm               │     audio centroid per playlist
    │                                           │  2. candidate_loading
    │  Phase B:                                 │  3. matching
    │    song_analysis — LLM over lyrics        │     weighted score, optional rerank
    │                                           │  4. publishing → match_result rows
    │  Phase C:                                 │
    │    song_embedding → pgvector              │
    ▼                                           ▼
                              Match Review (/match) · Playlist Studio
                                         │
                                User accepts / rejects
                                         │
                                Extension write-back
```

### Scoring

```
score = w_embed · cosine_similarity(song_vec, playlist_centroid)
      + w_audio · audio_feature_distance(song, playlist_centroid)
      + w_genre · weighted_genre_overlap(song, playlist_distribution)
```

Weights adapt to whichever signals are actually present for a candidate. Scores clamp to
`[0, 1]`. The optional Qwen3 cross-encoder reranks the top N and blends 70/30 with the
stage-1 score.

### Audio-feature backfill

Spotify's audio-features endpoint is gone, so the worker rebuilds those signals itself:
yt-dlp finds a YouTube source for the song (YT Music songs shelf, `ytsearch` fallback,
retry with an album/audio qualifier on low-confidence hits), ffmpeg extracts a clip,
candidates are scored and ranked, and the winning clip goes to ReccoBeats for features.
Snapshots are stamped with `SCORING_VERSION` so match quality can be analysed after the
fact; low-confidence matches fall through to manual review in the control panel.

This loop is gated on `NODE_ENV === "production"`, baked into `Dockerfile.worker` rather
than set as a Coolify env var so it can't be forgotten. It runs automatically in prod and
stays off locally, where it would only burn YouTube/ReccoBeats quota. The worker logs
`audio-backfill-disabled` on boot when off.

### Model versioning

`src/lib/domains/enrichment/embeddings/model-bundle.ts` hashes the embedding model, dimensions, provider, algorithm
versions, and playlist-profiling strategy (`hyde_v1` — HyDE cold-start expansion blended
with intent-query embeddings) into a single cache key. Changing any of them invalidates
cached embeddings and playlist profiles automatically.

Lyric prompts are versioned in `src/lib/domains/enrichment/content-analysis/prompts/` with an explicitly pinned
`ACTIVE_LYRICAL_VERSION` / `ACTIVE_INSTRUMENTAL_VERSION`. Prompt and matching experiments
live in `scripts/prompt-lab` and `scripts/matching-lab`.

### Jobs

`sync_liked_songs` · `sync_playlists` · `sync_playlist_tracks` · `extension_sync` ·
`audio_features` · `genre_tagging` · `song_analysis` · `song_embedding` · `enrichment` ·
`playlist_analysis` · `playlist_lightweight_enrichment` · `playlist_profiling` ·
`matching` · `rematch` · `target_playlist_match_refresh` · `match_snapshot_refresh`

---

## Tech Stack

### Application

| Layer              | Technology                                          |
| ------------------ | --------------------------------------------------- |
| Runtime            | Bun                                                 |
| Framework          | TanStack Start (SSR + server functions)             |
| Routing            | TanStack Router (file-based, type-safe + Zod)       |
| Data fetching      | TanStack Query v5                                   |
| UI                 | React 19                                            |
| Styling            | Tailwind CSS v4                                     |
| Animation          | GSAP · Framer Motion                                |
| Auth               | Better Auth (Google OAuth + email/password)         |
| Auth DB ORM        | Drizzle ORM + postgres.js (auth schema only)        |
| App DB             | Supabase JS client (all other data)                 |
| Database           | Postgres + pgvector (self-hosted Supabase)          |
| Validation         | Zod v4                                              |
| Error handling     | `better-result` (typed Result values)               |
| Deployment         | Cloudflare Workers (Wrangler, Smart Placement)      |
| Worker runtime     | Bun (separate process, Docker on Coolify)           |
| Typecheck          | `tsgo` (TypeScript native preview), `tsc` as legacy |
| Testing            | Vitest + Testing Library · Playwright for e2e       |
| Linting            | Biome                                               |
| Component workshop | Ladle                                               |
| Observability      | Sentry · PostHog (proxied via `/api/pulse-*`)       |

### Models

| Role       | Model                                          | Served by                            |
| ---------- | ---------------------------------------------- | ------------------------------------ |
| Analysis   | `gemini-2.5-flash`                             | Google Vertex AI (default, keyless)  |
| Distiller  | `gemini-2.5-flash-lite`                        | Google Vertex AI                     |
| Analysis   | `claude-sonnet-4` / `gpt-4o-mini`              | Anthropic / OpenAI (configurable)    |
| Embeddings | `Qwen/Qwen3-Embedding-0.6B` (512d, Matryoshka) | DeepInfra · HuggingFace · local ONNX |
| Reranker   | `Qwen/Qwen3-Reranker-0.6B`                     | DeepInfra · local ONNX               |

### External services

| Service        | Purpose                                                   |
| -------------- | --------------------------------------------------------- |
| Extension      | Library sync + Spotify write-back (replaces Spotify API)  |
| ReccoBeats     | Audio features (Spotify deprecated their endpoint)        |
| Last.fm        | Genre tagging                                             |
| Genius         | Lyrics (search + HTML scraping)                           |
| YouTube/yt-dlp | Audio source for the feature backfill                     |
| DeepInfra      | Embeddings + cross-encoder reranking                      |
| HuggingFace    | Embeddings (alternative provider)                         |
| Google Vertex  | LLM analysis                                              |
| Stripe         | Billing (webhooks handled by the brand site, bridged here) |
| Resend         | Transactional email                                       |
| Sentry         | Error tracking                                            |
| PostHog        | Product analytics + LLM cost tracking                     |

---

## Project Structure

```
v1_hearted/
├── src/
│   ├── routes/          # TanStack Router file-based routes
│   │   ├── index.tsx        # Landing
│   │   ├── login · forgot-password · reset-password · verify-email
│   │   ├── faq · privacy · terms · health
│   │   ├── @{$handle}.tsx   # Public profile
│   │   ├── _authenticated/  # Auth-guarded shell + sidebar
│   │   │   ├── dashboard · liked-songs · match · settings · onboarding
│   │   │   ├── playlists · playlists.$playlistRef
│   │   │   ├── playlists.new · playlists.new.studio
│   │   │   └── checkout/
│   │   └── api/             # extension · auth · billing-bridge · pulse-*
│   │
│   ├── features/        # Feature-sliced UI
│   │   ├── dashboard · landing · liked-songs · matching
│   │   ├── onboarding · settings
│   │   └── playlists/create/   # Playlist Studio
│   │
│   ├── lib/
│   │   ├── platform/    # Auth, job lifecycle, billing
│   │   ├── domains/     # Pure domain logic
│   │   │   ├── enrichment/  (audio-features, audio-feature-backfill,
│   │   │   │                 content-analysis, embeddings, lyrics)
│   │   │   ├── library/     (accounts, artists, liked-songs, playlists, songs)
│   │   │   └── taste/       (playlist-profiling, song-matching)
│   │   ├── workflows/   # enrichment-pipeline, library-processing,
│   │   │                #   match-snapshot-refresh, spotify-sync
│   │   ├── integrations/ # llm, providers, reranker, reccobeats,
│   │   │                 #   lastfm, youtube-audio
│   │   ├── server/      # TanStack Start server functions
│   │   ├── data/        # Supabase query helpers, generated DB types
│   │   ├── extension/   # Extension detection, Spotify command client
│   │   └── theme/       # Per-account hue theming
│   │
│   ├── components/      # Shared UI primitives
│   ├── worker/          # Background worker (poll loops, gateway, sweep, backups)
│   └── stories/         # Ladle story fixtures
│
├── extensions/          # Browser extension (Chromium + Firefox)
│   ├── src/
│   │   ├── background/  # Service worker (command routing, sync)
│   │   ├── content/     # Content scripts (token interception)
│   │   ├── popup/       # React popup (accounts panel)
│   │   └── shared/      # Spotify Pathfinder client, storage
│   └── scripts/build.ts
│
├── control-panel/       # Local-only operator app (never deployed)
├── shared/              # Code shared between app and extension
├── docs/                # Architecture docs, runbooks, analyses
├── openspec/            # Feature specifications
├── scripts/             # Dev/ops utilities + prompt/matching/language labs
└── supabase/migrations/ # Database migrations
```

---

## Control Panel

A local-only Bun + Vite operator app (`bun run control-panel`) for the review work the
pipeline can't fully automate: approving low-confidence audio-feature matches,
instrumental and lyrics review, release-year checks, batch inspection, user and library
lookups, prod metrics, and outbound email. Never deployed — it talks to whichever
database your env points at. See `control-panel/README.md`.

---

## Getting Started

### Prerequisites

- Bun 1.0+
- Local Supabase (`supabase start`) or a Postgres URL
- Google OAuth app (for sign-in)
- Extension built and connected (for library sync)

### Installation

```bash
git clone <repo>
cd v1_hearted
bun install
cp .env.example .env
```

Required:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

BETTER_AUTH_SECRET=at_least_32_chars
BETTER_AUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Optional — the pipeline degrades gracefully without these:

```env
LASTFM_API_KEY=              # genre tagging
GENIUS_CLIENT_TOKEN=         # lyrics

ML_PROVIDER=local            # local ONNX (default for dev)
DEEPINFRA_API_KEY=           # DeepInfra (prod)
HF_TOKEN=                    # HuggingFace Inference

GOOGLE_VERTEX_PROJECT=       # LLM analysis (default provider)
GOOGLE_VERTEX_LOCATION=      # AI SDK also reads ANTHROPIC_API_KEY / OPENAI_API_KEY

RESEND_API_KEY=
BILLING_ENABLED=false
VITE_CHROME_EXTENSION_ID=ohaaafmgbbfohhjhogonolonpjhhfohk
VITE_PUBLIC_APP_ORIGIN=http://127.0.0.1:5173   # https://hearted.music in prod
```

See `.env.example` for the full set, including backup and observability vars.

### Database

```bash
bunx supabase db push     # apply local migrations
bun run gen:types         # regenerate TS types from schema
```

Production migrations are applied by GitHub Actions before deploys when files under
`supabase/migrations/**` change on `main`. See `docs/ops/prod-db-migrations.md` for
the prod job, required secrets, PITR prerequisite, and the safe-vs-manual policy.

### Development

```bash
bun run dev:all           # app + worker + gateway + embedding sidecar
```

Or individually:

```bash
bun run dev               # web app (ML_PROVIDER=local)
bun run dev:worker        # background worker
bun run dev:gateway       # account-events gateway
bun run dev:embeddings    # local embedding sidecar
bun run ext:dev           # extension, watch mode
bun run control-panel     # operator app (API + web)
```

`bun run dev:monetization` adds the brand site and a Stripe webhook listener.

---

## Scripts

| Command                     | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `bun run test`              | Vitest (unit + integration)                    |
| `bun run test:live`         | Vitest including live-network suites           |
| `bun run test:e2e`          | Playwright auth flow                           |
| `bun run typecheck`         | `tsgo --noEmit`                                |
| `bun run check`             | Biome lint + format                            |
| `bun run build`             | Production Vite build                          |
| `bun run deploy`            | Build + `wrangler deploy`                      |
| `bun run deploy:secrets`    | Push env vars as Wrangler secrets              |
| `bun run gen:types`         | Regenerate DB types from local schema          |
| `bun run ladle`             | Component workshop                             |
| `bun run fixtures`          | Rebuild Ladle fixtures from DB snapshots       |
| `bun run ext:build`         | Build extension (`:firefox`, `:store` variants) |
| `bun run prod:sql`          | Direct SQL against prod Postgres               |
| `bun run prod:rest`         | PostgREST against prod (service role)          |
| `bun run reset:onboarding`  | Reset onboarding for a dev/test account        |
| `bun run grant:liked-access`| Grant liked-song access to an account          |
| `bun run warm:match-deck`   | Pre-warm match deck proposals                  |
| `bun run hash:sync`         | Sync Spotify Pathfinder query hashes           |
| `bun run voice-audit`       | Audit copy against the brand voice guide       |

### `reset:onboarding`

Warm reset by default — clears workflow state without touching the synced library:

```bash
bun run reset:onboarding user@example.com
bun run reset:onboarding --account-id <uuid>
bun run reset:onboarding --spotify-id <spotify-user-id>

# Colder resets:
#   --wipe-library      also delete liked songs + playlists
#   --clear-api-token   also revoke the extension API token
```

---

## Design System

Typography-driven, editorial:

- **Display**: Instrument Serif
- **Body**: Geist
- **Palette**: Monochromatic HSL — per-account hue theming (12–32% saturation)
- **Themes**: Warm (rose, default) · Calm (blue) · Fresh (green) · Dreamy (lavender)

---

## Observability

Errors flow into one Sentry project, tagged by `runtime` (`web` / `web-server` / `worker`).

| Var                  | Surface        | Where to set                                    |
| -------------------- | -------------- | ----------------------------------------------- |
| `VITE_SENTRY_DSN`    | Client bundle  | `.env` (read at build time)                     |
| `SENTRY_DSN`         | Worker runtime | `.env.cloud` → `bun run deploy:secrets`         |
| `SENTRY_ENVIRONMENT` | Both           | `.env.cloud` (server), `.env` (client)          |
| `SENTRY_AUTH_TOKEN`  | Build only     | CI env — source maps + tunnel. Never commit.    |

Local `bun run dev` exercises the client init only (the Cloudflare adapter isn't in the
dev path). Leave `VITE_SENTRY_DSN` unset locally and Sentry stays silent.

PostHog covers product analytics and LLM cost tracking, proxied through `/api/pulse-h`
and `/api/pulse-s` to survive blockers.

---

## Documentation

| Path                                       | Contents                                            |
| ------------------------------------------ | --------------------------------------------------- |
| `docs/architecture/system-overview.md`     | Start here                                          |
| `docs/architecture/library-processing.md`  | Library-processing state machine design             |
| `docs/architecture/matching/`              | Matching and profiling design                       |
| `docs/architecture/module-boundaries.md`   | Layering rules between domains/workflows/integrations |
| `docs/playlist-creation/`                  | Playlist Studio conceptualization + specs           |
| `docs/ops/youtube-audio-match-analysis.md` | Backfill match-quality analysis                     |
| `docs/ops/prod-db-migrations.md`           | Prod migration workflow, secrets, rollback policy   |
| `docs/ops/prod-db-backups.md`              | Backup strategy, worker backup env, restore runbook |
| `docs/plans/hyperdrive-private-database.md` | Future private Worker-to-Postgres connectivity      |
| `docs/brand/`                              | Brand voice, copy guide, positioning                |
| `src/routes/README.md`                     | Routes layout and conventions                       |
| `control-panel/README.md`                  | Operator app                                        |
| `openspec/specs/`                          | Feature specifications                              |
| `supabase/migrations/`                     | Database migration history                          |

---

## License

MIT
