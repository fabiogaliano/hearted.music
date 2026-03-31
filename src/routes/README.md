# Routes & Project Architecture

Developer reference for routes layout, architecture, the matching pipeline, and the tech stack.

---

## Routes

File-based routing via TanStack Router. All routes live here; the generated tree is at `src/routeTree.gen.ts`.

```
routes/
├── __root.tsx                    ← Root layout (providers, global error boundary)
├── index.tsx                     ← / (landing page)
├── login.tsx                     ← /login
├── faq.tsx                       ← /faq
├── privacy.tsx                   ← /privacy
├── terms.tsx                     ← /terms
│
├── dev-error.tsx                 ← /dev-error        (dev only)
├── dev-extension-step.tsx        ← /dev-extension-step (dev only)
├── dev-playground.tsx            ← /dev-playground   (dev only)
│
├── _authenticated/               ← Layout group — auth-guarded shell + sidebar
│   ├── route.tsx                 ← Layout wrapper (session check, redirect to /login)
│   ├── dashboard.tsx             ← /dashboard
│   ├── liked-songs.tsx           ← /liked-songs
│   ├── match.tsx                 ← /match (match review session)
│   ├── onboarding.tsx            ← /onboarding
│   ├── playlists.tsx             ← /playlists
│   ├── settings.tsx              ← /settings
│   └── -components/              ← Private co-located components (prefix `-` = not a route)
│       ├── NavItem.tsx
│       └── Sidebar.tsx
│
├── api/
│   ├── auth/
│   │   └── $.ts                  ← /api/auth/* — Better Auth catch-all handler
│   └── extension/
│       ├── sync.tsx              ← POST /api/extension/sync
│       ├── status.tsx            ← GET  /api/extension/status
│       └── token.tsx             ← POST /DELETE /api/extension/token
│
└── auth/
    └── logout.tsx                ← /auth/logout
```

### File naming conventions

| Pattern       | Example                      | URL               | Purpose                  |
| ------------- | ---------------------------- | ----------------- | ------------------------ |
| `index.tsx`   | `posts/index.tsx`            | `/posts`          | Exact segment match      |
| `$param`      | `jobs/$id.tsx`               | `/jobs/123`       | Dynamic param            |
| `$`           | `auth/$.ts`                  | `/auth/anything`  | Wildcard / catch-all     |
| `route.tsx`   | `_authenticated/route.tsx`   | —                 | Layout only (no URL)     |
| `_prefix/`    | `_authenticated/`            | —                 | Pathless layout group    |
| `-prefix`     | `-components/`               | —                 | Private (not a route)    |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Browser / Chrome                      │
│                                                          │
│  ┌───────────────────────┐   ┌────────────────────────┐  │
│  │   hearted. Web App    │   │  Chrome Extension      │  │
│  │  (TanStack Start SSR) │   │  (Manifest V3)         │  │
│  │                       │   │                        │  │
│  │  React 19 + Router    │◄──│  content scripts       │  │
│  │  TanStack Query       │   │  background SW         │  │
│  │  Better Auth client   │   │  popup (React)         │  │
│  └──────────┬────────────┘   └──────────┬─────────────┘  │
└─────────────│────────────────────────────│────────────────┘
              │  HTTPS (session cookie     │  chrome.runtime.sendMessage
              │  or Bearer token)          │  POST /api/extension/sync
              ▼                            ▼
┌─────────────────────────────────────────────────────────┐
│               Cloudflare Workers (SSR)                  │
│                                                         │
│  TanStack Start server functions + raw HTTP handlers    │
│  Better Auth  ·  Supabase admin client                  │
│  Library-processing state machine                       │
│  Job lifecycle (create / start / complete / sweep)      │
└──────────────────────────┬──────────────────────────────┘
                           │ Postgres (Supabase)
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 Background Worker (Bun)                 │
│                                                         │
│  Polls `job` table  ·  Health HTTP server               │
│  Enrichment pipeline chunks                             │
│  Match snapshot refresh                                 │
└─────────────────────────────────────────────────────────┘
```

### Source layout

```
src/
├── routes/           ← TanStack Router file-based routes (this directory)
├── features/         ← Feature-sliced UI components
│   ├── dashboard/
│   ├── landing/
│   ├── liked-songs/
│   ├── matching/
│   ├── onboarding/
│   └── playlists/
├── lib/
│   ├── platform/     ← Auth (Better Auth), job lifecycle
│   ├── domains/      ← Pure domain logic
│   │   ├── enrichment/   (audio-features, content-analysis, embeddings, genre-tagging, lyrics)
│   │   ├── library/      (accounts, artists, liked-songs, playlists, songs)
│   │   └── taste/        (playlist-profiling, song-matching)
│   ├── workflows/    ← Multi-step orchestration
│   │   ├── enrichment-pipeline/
│   │   ├── library-processing/
│   │   ├── match-snapshot-refresh/
│   │   ├── playlist-sync/
│   │   └── spotify-sync/
│   ├── integrations/ ← External service adapters
│   │   ├── audio/        (ReccoBeats)
│   │   ├── deepinfra/
│   │   ├── huggingface/
│   │   ├── lastfm/
│   │   ├── llm/          (AI SDK multi-provider)
│   │   ├── providers/    (embedding provider factory)
│   │   ├── reccobeats/
│   │   └── reranker/
│   ├── server/       ← TanStack Start server functions (createServerFn)
│   ├── data/         ← Supabase query helpers, DB types
│   ├── extension/    ← Extension detection, Spotify command client, write-back
│   ├── keyboard/     ← Keyboard shortcut system
│   └── theme/        ← Per-account hue theming
├── components/       ← Shared UI primitives
├── worker/           ← Background worker entry point
└── stories/          ← Ladle story fixtures
```

```
extension/            ← Chrome extension (separate build)
├── src/
│   ├── background/   ← Service worker (command routing, sync orchestration)
│   ├── content/      ← Content scripts (token interception on open.spotify.com)
│   ├── popup/        ← React popup UI
│   └── shared/       ← Spotify Pathfinder client, storage, mappers
│
shared/               ← Code shared between web app and extension
└── spotify-command-protocol.ts   ← Typed command/response protocol
```

---

## Chrome Extension

The extension replaces the Spotify Web API, which no longer provides audio features or free third-party access. Instead of OAuth → Spotify REST, the extension intercepts Spotify's own internal session and exposes it to hearted.

### How it works

```
open.spotify.com
      │
      │  content/intercept-token.ts
      │  Observes fetch() calls, captures Spotify access tokens
      │
      ▼
background/service-worker.ts
      │
      ├── Stores captured token + expiry in chrome.storage
      │
      ├── On TRIGGER_SYNC message:
      │     Uses token to query Spotify's internal Pathfinder GraphQL API
      │     (fetchLibraryTracks, libraryV3, fetchPlaylistContents, profileAttributes)
      │     Batches and paginates all liked songs + playlists + playlist tracks
      │
      └── POST /api/extension/sync
            Pushes full library snapshot to hearted. backend
```

### Extension ↔ web app communication

The web app communicates with the extension via `chrome.runtime.sendMessage` (requires `externally_connectable` in the manifest, configured for the hearted. domain):

| Message type     | Direction          | Purpose                                          |
| ---------------- | ------------------ | ------------------------------------------------ |
| `PING`           | App → Extension    | Detect if extension is installed                 |
| `PONG`           | Extension → App    | Confirm presence                                 |
| `CONNECT`        | App → Extension    | Pass API token + backend URL after onboarding    |
| `CONNECTED`      | Extension → App    | Confirm pairing                                  |
| `GET_STATUS`     | App → Extension    | Get sync state, token presence                   |
| `TRIGGER_SYNC`   | App → Extension    | Request a library sync (fire-and-forget)         |
| `SPOTIFY_COMMAND`| App → Extension    | Write-back command (add/remove/create playlist…) |

### Extension API endpoints

| Endpoint                      | Auth                          | Purpose                                        |
| ----------------------------- | ----------------------------- | ---------------------------------------------- |
| `POST /api/extension/sync`    | Session cookie or Bearer token | Receive full library snapshot, enqueue jobs    |
| `GET  /api/extension/status`  | Session cookie or Bearer token | Account auth state, liked song & playlist counts |
| `POST /api/extension/token`   | Session cookie (required)     | Generate a new API token                       |
| `DELETE /api/extension/token` | Session cookie (required)     | Revoke all tokens for account                  |

API tokens are long-lived opaque Bearer tokens stored in `api_token`. The extension stores the token in `chrome.storage` after `CONNECT`.

### Spotify write-back (via extension)

Accepted match decisions are written back to Spotify by sending typed commands from the web app through `shared/spotify-command-protocol.ts`. The extension's service worker receives each command and forwards it to Spotify's internal Pathfinder mutation API (no OAuth needed — uses the intercepted session token):

| Command              | Payload                                             |
| -------------------- | --------------------------------------------------- |
| `addToPlaylist`      | `playlistUri`, `trackUris[]`, `position`            |
| `removeFromPlaylist` | `playlistUri`, `uids[]`                             |
| `createPlaylist`     | `name`, `userId`                                    |
| `updatePlaylist`     | `playlistId`, `name?`, `description?`               |
| `deletePlaylist`     | `playlistUri`, `userId`                             |
| `queryArtistOverview`| `artistUri`, `locale?`                              |

---

## Matching Pipeline

The full pipeline runs across multiple asynchronous jobs orchestrated by the library-processing state machine.

```
Extension sync
      │
      ▼
POST /api/extension/sync
      │  Writes liked_song + playlist + playlist_song rows
      │  Creates three phase jobs (sync_liked_songs, sync_playlists, sync_playlist_tracks)
      │
      ▼
applyLibraryProcessingChange(library_synced)
      │  Reconciler inspects change facts
      │  Emits effects: ensure_enrichment_job, ensure_match_snapshot_refresh_job
      │
      ├──────────────────────────────────────────────────────┐
      ▼                                                      ▼
Enrichment job                                   Match Snapshot Refresh job
(worker picks up via poll)                       (worker picks up after enrichment)
      │                                                      │
      ▼                                                      ▼
┌─────────────────────────┐              ┌──────────────────────────────────────┐
│ Enrichment Pipeline     │              │ Match Snapshot Refresh               │
│                         │              │                                      │
│ Phase A (parallel):     │              │ 1. target_song_enrichment (optional) │
│   audio_features        │              │    Lightweight enrichment for songs  │
│   genre_tagging         │              │    in target playlists               │
│                         │              │                                      │
│ Phase B:                │              │ 2. playlist_profiling                │
│   song_analysis         │              │    Build profile per target playlist:│
│   (LLM — headline,      │              │    centroid embedding, genre dist.,  │
│   themes, mood,         │              │    audio feature centroid            │
│   interpretation)       │              │                                      │
│                         │              │ 3. candidate_loading                 │
│ Phase C:                │              │    Load all data-enriched songs      │
│   song_embedding        │              │                                      │
│   (text → vector via    │              │ 4. matching                          │
│   instruction-tuned     │              │    MatchingService.matchBatch():     │
│   embedding model)      │              │      · Vector similarity (cosine)    │
│                         │              │      · Audio feature score           │
│ Marks songs as pipeline │              │      · Genre overlap                 │
│ processed in item_status│              │    Adaptive weights per data avail.  │
│                         │              │    Optional cross-encoder reranking  │
│ Signals new candidates  │              │                                      │
│ available if any song   │              │ 5. publishing                        │
│ became fully enriched   │              │    Writes match_result rows          │
└─────────────────────────┘              │    (song_id, playlist_id, score,     │
                                         │    rank, factors)                    │
                                         └──────────────────────────────────────┘
                                                          │
                                                          ▼
                                               Match Review UI (/match)
                                                          │
                                               User accepts / rejects each match
                                                          │
                                                          ▼
                                               Accepted → extension write-back
                                               (SPOTIFY_COMMAND addToPlaylist)
```

### Enrichment stages

| Stage           | Service                    | What it produces                                              |
| --------------- | -------------------------- | ------------------------------------------------------------- |
| `audio_features`| ReccoBeats API             | energy, valence, danceability, acousticness, etc.             |
| `genre_tagging` | Last.fm API                | Genre tags normalised against a curated whitelist             |
| `song_analysis` | LLM (AI SDK)               | Structured JSON: headline, mood, themes, interpretation, etc. |
| `song_embedding`| Embedding model            | Dense vector stored in `song_embedding` (pgvector)            |

### Playlist profiling

Before matching, each target playlist is profiled by aggregating its member songs (those that are also liked songs):

- **Centroid embedding** — mean of member song embeddings
- **Genre distribution** — weighted count map across all genres
- **Audio centroid** — mean of all audio feature dimensions
- **LLM-generated intent** (optional, cold-start via `intent-expansion`) — descriptive text embedding for new or sparse playlists

### Scoring

Final score is a weighted sum of three factors; weights adapt based on which data is available for the candidate song:

```
score = w_embed · cosine_similarity(song, playlist_centroid)
      + w_audio · audio_feature_distance(song, playlist_centroid)
      + w_genre · weighted_genre_overlap(song, playlist_distribution)
```

Scores are clamped to `[0, 1]`. Results below `minScoreThreshold` are discarded. Top `maxResultsPerSong` survive per song. An optional cross-encoder reranker (DeepInfra) can refine the ranked list.

### Library-processing state machine

`lib/workflows/library-processing/` owns the driver logic:

- **Reconciler** — pure function: `(state, change) → { state, effects[] }`
- **Changes** — typed discriminated union (`library_synced`, `onboarding_target_selection_confirmed`, `enrichment_completed`, `match_snapshot_published`)
- **Effects** — `ensure_enrichment_job`, `ensure_match_snapshot_refresh_job`
- **Service** — `applyLibraryProcessingChange()`, single public entrypoint; loads state, runs reconciler, persists, executes effects

---

## Tech Stack

### Frontend

| Layer             | Library / Tool                                          |
| ----------------- | ------------------------------------------------------- |
| Framework         | React 19                                                |
| SSR + routing     | TanStack Start · TanStack Router (file-based)           |
| Data fetching     | TanStack Query v5 · TanStack Router SSR Query           |
| Search params     | `@tanstack/zod-adapter`                                 |
| Animation         | GSAP + `@gsap/react` · Framer Motion                    |
| Styling           | Tailwind CSS v4 · `tw-animate-css` · `class-variance-authority` |
| Number animation  | `@number-flow/react`                                    |
| Icons             | `lucide-react`                                          |
| Notifications     | `sonner`                                                |
| HTTP client       | `wretch`                                                |

### Backend (server functions + API routes)

| Layer          | Library / Tool                                |
| -------------- | --------------------------------------------- |
| Auth           | Better Auth (Google OAuth, session cookies)   |
| Auth DB ORM    | Drizzle ORM + postgres.js (auth schema only)  |
| App DB         | Supabase JS client (all other data)           |
| Validation     | Zod v4                                        |
| Error handling | `better-result` (typed Result/Error values)   |
| Email          | Resend                                        |

### AI / ML

| Concern              | Provider / Library                                              |
| -------------------- | --------------------------------------------------------------- |
| LLM                  | AI SDK (`ai`) — Anthropic Claude, Google Gemini, OpenAI         |
| Embeddings (remote)  | DeepInfra inference API · HuggingFace Inference API             |
| Embeddings (local)   | `@huggingface/transformers` (transformers.js, in-process)       |
| Audio features       | ReccoBeats API (free, replaces deprecated Spotify endpoint)     |
| Genre tagging        | Last.fm API                                                     |
| Lyrics               | Genius API (HTML scraping + parser)                             |
| Reranking            | DeepInfra cross-encoder                                         |

Embedding provider is selected at runtime via `ML_PROVIDER` env var (`local` | `deepinfra` | `huggingface`). The factory in `lib/integrations/providers/factory.ts` returns a uniform `MLProvider` port.

### Infrastructure

| Concern          | Tool / Service                                        |
| ---------------- | ----------------------------------------------------- |
| Deploy           | Cloudflare Workers (via Wrangler + `@cloudflare/vite-plugin`) |
| Database         | Supabase (Postgres + pgvector extension)              |
| Build            | Vite 7                                                |
| Runtime (worker) | Bun                                                   |
| Worker deploy    | Docker (`Dockerfile.worker`)                          |
| Linting          | Biome                                                 |
| Testing          | Vitest + Testing Library + jsdom                      |
| Component workshop | Ladle                                               |
| Git hooks        | Lefthook                                              |

---

## Scripts

All scripts run with `bun scripts/<name>.ts` unless noted.

| Script / Command              | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `bun run dev`                 | Dev server with local ML provider (`ML_PROVIDER=local`)                 |
| `bun run dev:ui`              | Dev server without devtools overlay                                     |
| `bun run dev:worker`          | Background worker in watch mode                                         |
| `bun run dev:embeddings`      | Local embedding sidecar for `ML_PROVIDER=local`                         |
| `bun run build`               | Production Vite build                                                   |
| `bun run deploy`              | Build + `wrangler deploy`                                               |
| `bun run deploy:secrets:waitlist` | Push `.env.cloud` vars as Wrangler secrets (waitlist mode)          |
| `bun run deploy:secrets:released` | Push `.env.cloud` vars as Wrangler secrets (released mode)          |
| `bun run test`                | Vitest (all unit tests)                                                 |
| `bun run typecheck`           | `tsc --noEmit`                                                          |
| `bun run check`               | Biome check (lint + format)                                             |
| `bun run gen:types`           | Regenerate `src/lib/data/database.types.ts` from local Supabase schema  |
| `bun run ladle`               | Component workshop (Ladle)                                              |
| `bun run fixtures`            | Rebuild Ladle story fixtures from DB snapshots                          |
| `bun run lyrics:snapshot`     | Generate lyrics parser snapshots                                        |
| `bun run lyrics:validate`     | Run lyrics integration tests against snapshots                          |
| `bun run ext:build`           | Build Chrome extension (production)                                     |
| `bun run ext:dev`             | Build Chrome extension in watch mode                                    |
| `bun run ext:store`           | Build Chrome extension for Chrome Web Store submission                  |
| `bun run reset:onboarding`    | Reset onboarding for a dev/test account (see below)                     |

### `reset:onboarding`

Warm reset by default — resets onboarding state and clears workflow outputs without touching the synced library:

```bash
bun run reset:onboarding user@example.com
bun run reset:onboarding --account-id <uuid>
bun run reset:onboarding --spotify-id <spotify-user-id>

# Colder reset options:
bun run reset:onboarding user@example.com --wipe-library      # also delete liked songs + playlists
bun run reset:onboarding user@example.com --clear-api-token   # also revoke extension API token
```

What a warm reset clears: jobs, item_status, match data, match decisions, library_processing_state, target playlist flags, onboarding preferences.  
What it preserves: liked songs, playlists, extension API token.

---

## Resources

- [TanStack Router — file-based routing](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing)
- [TanStack Start — server functions](https://tanstack.com/start/latest/docs/framework/react/server-functions)
- [Better Auth docs](https://www.better-auth.com/docs)
- [Supabase JS client](https://supabase.com/docs/reference/javascript)
- [ReccoBeats API](https://reccobeats.com)
