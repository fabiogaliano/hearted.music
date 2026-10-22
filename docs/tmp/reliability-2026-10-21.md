# hearted.music reliability: diagnosis, decisions, plan (2026-10-21)

One document. Part A is what is wrong and how we know. Part B is one card per issue with
the decision, the research behind it, and the work it implies. Part C is the order to do it
in and what is still open. Nothing in this document has been implemented; a draft of the
three small code fixes (#4, #5, #8) sits in `git stash` (`stash@{0}`) for when they are
picked up.

Effort scale: **S** < ½ day · **M** 1–2 days · **L** 3–5 days · **XL** a week+.

---

## Part A — Diagnosis

### Symptoms

- 2026-10-17 15:37–15:43 UTC: headless page loads of `/dashboard`, `/liked-songs`,
  `/playlists/new`, `/match` intermittently returned Cloudflare 1102 / HTTP 503.
- Errors continued for hours after the load stopped.
- 2026-10-21: one `/playlists/new` → Start run showed "Nothing matches"; the same flow
  minutes earlier returned songs.

### What was checked

| Source | Used for |
|---|---|
| Cloudflare GraphQL analytics (`workersInvocationsAdaptive`, zone `httpRequestsAdaptive`) via the wrangler OAuth token | per-minute invocation outcomes, CPU quantiles, per-request edge log |
| Cloudflare REST script settings | `limits: null`, smart placement, observability on |
| `wrangler secret list` | Worker runtime env (names only) |
| Sentry CLI | client-side events, server span durations |
| `bun run prod:sql` (one read-only aggregate) | which embedding models exist in prod |
| Live site | two unauthenticated probes (server-fn 403, SSE gateway CORS) |
| Throwaway Bun probe against installed `@tanstack/start-client-core` | RPC client behaviour on 503 |

Not available: Workers Logs telemetry and the subscriptions API (token scope), PostHog
(the `.env*` read guard), the headless harness itself.

### Timeline (UTC)

**10-17.** 15:33 load starts (55→175 invocations/min vs a baseline of 2–12). 15:36 first
`exceededResources` kills, CPU p50 exactly **10.000 ms**. 15:36:40 and 15:42:48 Sentry
client crashes in `getNextPageParam` 13–130 ms after a server-fn GET returned 503 (813-byte
body). Load stops ~15:45; kills continue at 100–214/hour until 23:00, almost all on
`getAccountEventsToken` and `getActiveJobs`.

**10-18.** 12:00–19:00: 36–219 kills/hour, same endpoints, until the test tabs close. None on
10-19/10-20.

**10-21.** 14:02:00 `POST previewPlaylistDraft` → 200 (songs shown). 14:02:34 new
`/playlists/new` load. **14:02:41 `POST previewPlaylistDraft` → 503**; Worker analytics for
that minute: 2 × `exceededResources`, CPU max **419 ms**. The studio hook renders any
failure as "Nothing matches". 14:02:45–14:02:53: token mint ×2 and `getActiveJobs` → 503
(10 ms kills). Every preview in this window also made a `POST
router.huggingface.co/hf-inference/…/all-MiniLM-L6-v2/…` → **401**.

### Findings

| # | Finding | Status |
|---|---|---|
| F1 | The Worker runs under a **10 ms CPU-per-invocation limit** (Workers Free). Successful invocations use p50 ≈ 10 ms, p99 100–280 ms, max 540 ms (10-21). Cloudflare's limits page: isolates have "built-in flexibility" for infrequent overruns; "if your Worker starts hitting the limit consistently, its execution will be terminated according to the limit configured." Killed invocations clamp at 10.000 ms. | Confirmed (limit value from the kill signature; plan name not readable via API) |
| F2 | **Client loops sustained enforcement for ~28 h**: `useAccountEvents` re-mints a token on every reconnect (backoff cap 30 s, no hidden-tab pause, 5xx treated like a stream close) and `useActiveJobs` polls every 15 s whenever the stream is not `connected`. ≈229 mints/hour overnight, 45 % of them 503. | Confirmed (zone analytics + code) |
| F3 | **The studio preview is the heaviest request** (400–540 ms CPU): `loadPhase1Candidates` pages up to 10 k liked songs through PostgREST and `rankCandidates` → `createMatchingService().matchBatch` scores all of them in the Worker. SSR pages cost 100–280 ms. Every authenticated request pays ≈10 ms of fixed overhead (Sentry `init()` per request + 2 s flush via `waitUntil`, a fresh `betterAuth()` per request, cold-isolate compile of the 870 KB auth chunk and the 781 KB taste chunk). | Confirmed by analytics; the per-request attribution is from code, not profiled |
| F4 | **"Nothing matches" on failure**: `useCreatePlaylistDraft` does `data ?? EMPTY_PREVIEW_RESULT`, exposes `isError`, but `StudioScreen` never reads it and `getStudioPreviewState` only knows `isLoading`. | Confirmed |
| F5 | **The Start RPC client resolves a non-OK JSON body to `undefined`**: `serverFnFetcher.getResponse` returns any `application/json` body lacking `x-tss-serialized` as a success envelope; `createServerFn` reads `.result` → `undefined`; `infiniteQueryBehavior` stores it as a page and the next render crashes. Probe output: 503 JSON → `undefined`; 503 HTML/text → throws. Upstream 1.170.38 (2026-10-16) unchanged. | Mechanism confirmed; that Cloudflare served the 1102 as JSON (RPC `accept` lists `application/json`) is inferred from the crash signature |
| F6 | **The Worker never had an embedding provider.** `wrangler secret list` has no `DEEPINFRA_API_KEY`, `ML_PROVIDER`, `HF_TOKEN`; `.env.cloud` has none; `scripts/ops/env-to-secrets.ts` has `SKIP_KEYS = new Set(["ML_PROVIDER"])`; CI only sets `ACCOUNT_EVENTS_TOKEN_SECRET`. The factory falls back to anonymous HuggingFace MiniLM-384d → 401 on every intent embed. Prod `song_embedding`: 9,448 rows, all `Qwen/Qwen3-Embedding-0.6B` 512-d (written by the Bun worker, which is configured). So studio intent never applies and stored vectors are never loaded (model mismatch). | Confirmed |
| F7 | **Nobody could see it**: a 1102 kills the isolate before `withSentry` captures; `enableLogs:false` discards server `console.error`; the wrangler token lacks the observability scope; no Cloudflare notification. Sentry: 5 issues in 90 days vs 2,100 kills in two days. | Confirmed |
| F8 | **Hydration mismatch** for users who dismissed the unverified-email or waitlist banner: `src/routes/_authenticated/route.tsx` reads `sessionStorage`/`localStorage` inside `useState` initializers (lines ~222 and ~357). Sentry HEARTED-MUSIC-1G (real Chrome, 10-16/17, a fresh account walking onboarding) fits. | Confirmed by code; link to 1G likely |
| F9 | **Silent-empty error handling**: `getLikedSongsPage` returns `{songs: [], nextCursor: null}` on DB error; `loadAuthSession` returns null on outage (user looks logged out); `rankCandidates` returns unscored order; embedding failures are `console.error` only. | Confirmed by code |
| F11 | **The CSP blocks the SSE gateway for everyone** (`connect-src` omits `events.hearted.music`), so SSE has never connected in production and every tab re-mints a token every 15–30 s while polling `getActiveJobs`. See Part C item 7. | Confirmed by code, live header, zone analytics and breadcrumbs |
| F10 | Minor: `getSongEmbeddingsBatch` feeds DB-derived ids back as `.in()` (project rule); bot scans (`/wp-login.php`, `/.env`, …) are SSR'd as 404s; Sentry's 2 s flush holds every invocation (wall p50 ≈ 2.1 s); route error components report `handled: yes`. | Confirmed |

Ruled out: memory limit (kills are CPU-shaped), code regression (release `b7d7e7d6` since
10-08), payload size (SSR 9–31 KB), viewport width.

### Where the previous quick pass (`investigation-1102-2026-10-21.md`) differs

Agree on F1, F2, the Ray-ID mapping, per-request Sentry/Better Auth overhead. Disagree with
"no embedding/vector math runs in the Worker" (F3: `rankCandidates` scores in the Worker; the
10-21 kill is that path) and with "not caused by a heavy route" (heavy routes keep the Worker
permanently over budget and die first once enforcement is on). New here: F4 mechanism, F5
reproduction, F6, F8, F9, the 10-21 timeline.

---

## Part B — Cards

Decisions already taken by Fábio:

1. No Workers Paid; the app server moves to the VPS.
2. Preview ranking: Postgres RPC (recommended below), after the move.
3. The Worker was never configured for embeddings (F6); it converges with the move.
4. Refactor properly: R2, R5, R6 carry #2, #4, #5, #9.
5. Re-run the headless harness with network capture.

### #1 · Move the app server to the VPS

**Problem.** F1. Staying on Workers Free means every SSR and server fn must fit 10 ms CPU;
React SSR alone cannot.

**Options**

| | Effort | Trade-off |
|---|---|---|
| **A. Bun container on the VPS (Coolify), Cloudflare stays as DNS/proxy/WAF/asset cache** | L | Same deploy shape as the Bun worker and SSE gateway. No latency regression: Smart Placement already executes SSR next to the VPS Postgres. |
| B. SPA on Workers/Pages + server fns on the VPS | L–XL | Split origin (CORS, cookie domain, two deploys), landing SEO lost. No. |
| C. Stay on Workers, SPA mode, every server fn < 10 ms | XL | Still fragile (auth + Sentry ≈ 10 ms), worse product. No. |

**Decision: A.**

**Touch points (verified by grep)**

| Area | Today | After |
|---|---|---|
| Server entry | `src/server.ts` wraps Start's server entry in `Sentry.withSentry` | Bun entry serving the Start fetch handler plus `dist/client` |
| Sentry SDK | `@sentry/cloudflare` in `server.ts`, `deck-view.ts`, `capture-server-error.ts`, `pulse-s.ts` | `@sentry/bun`, one init per process |
| `waitUntil` | `auth.server.ts:123`, `auth-request-state.server.ts:188`, `posthog-server.ts:61` (all with fallbacks) | one `runAfterResponse` helper |
| Rate limiting | Workers binding; **fails open when missing** (`edge-rate-limit.ts:43,47`) | see research R-3 |
| Secrets | `wrangler secret` from `.env.cloud` | Coolify env, same source as the worker (fixes F6) |
| CI | `deploy-app` → `bun run deploy` | `Dockerfile.app` + Coolify deploy like the worker job |
| Edge | custom domain on the Worker | proxied A record → VPS; cache `/assets/*`; WAF rule for bot paths |

**Research findings (R-1, app server hosting).** Opus pass; it built a scratch copy without
the Cloudflare plugin and ran it under Bun. [V] verified, [I] inferred.

- **Build output** [V]: with the `cloudflare()` plugin removed, `vite build` emits
  `dist/server/server.js` whose only export is `default = { fetch }` (a web
  `fetch(request)` handler), chunks in `dist/server/assets/`, client in `dist/client/`. About
  49 npm packages stay as runtime imports (not bundled as on Workers), so the image needs
  production `node_modules`. `preset: "node-ws"` in `vite.config.ts` is **ignored**: the
  plugin's options schema has no `preset` key and drops unknown keys (hence the
  `@ts-expect-error`).
- **It runs on Bun** [V]: `Bun.serve({ fetch: (req, srv) => handler.fetch(req, srv) })` served
  pages. Two catches: the build needs `VITE_PUBLIC_APP_ORIGIN` and
  `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` or every request 500s (reproduced; a missing value
  still builds green), and `Sentry.withSentry` is silently inert under Bun (it reads config
  from the handler's second argument, which is Bun's `Server`), so `@sentry/bun` is required
  before cutover (R-3).
- **Static assets** [V]: the Start server does not serve `dist/client` (`/assets/*.css` and
  `/robots.txt` returned the router's 404 HTML). The Bun entry serves them: hashed
  `/assets/*` with `Cache-Control: public, max-age=31536000, immutable`, unhashed public files
  with a short max-age + ETag [I]. `public/_headers` (HSTS, Permissions-Policy) only works on
  Workers assets; move those headers into the entry or a Cloudflare response-header rule.
  Set `idleTimeout: 120` on `Bun.serve` (Bun's default is 10 s and would cut slow server fns;
  120 sits above Cloudflare's 100 s).
- **Official shape** [V]: TanStack's hosting guide recommends Nitro `preset: 'bun'` or their
  example Bun `server.ts`. Nitro is not installed. Recommendation [I]: a ~40-line Bun entry
  (`Bun.serve({ idleTimeout, routes: <dist/client files>, fetch: handler.fetch })`) rather
  than adding Nitro.
- **Existing deploy wiring** [V]: CI never pushes images; `main.yml:399-429` POSTs to
  `COOLIFY_WORKER_DEPLOY_HOOK` / `COOLIFY_GATEWAY_DEPLOY_HOOK` (Coolify token + CF Access
  headers) and Coolify builds the Dockerfile from git. CI smoke-builds the worker image and
  asserts it fails with "Invalid environment variables" (`:138-149`), proving the import graph
  loads. `Dockerfile.worker` pattern: `oven/bun:1.3.14`, deps stage with
  `--frozen-lockfile --production`, `USER bun`, exec-form `HEALTHCHECK` on `/health`.
- **`Dockerfile.app`** [I]: build stage with full install + `RELEASE=true vite build` (the
  `VITE_*` values from `main.yml:342-356`, `SENTRY_AUTH_TOKEN`, `VITE_APP_RELEASE` are baked
  in at build time); runtime stage with production `node_modules`, `dist/`, the Bun entry;
  a per-file `Dockerfile.app.dockerignore` because the shared `.dockerignore` excludes
  `vite.config.ts`, `public` and `scripts`; `src/routes/health.ts` already returns `release`
  for the healthcheck and for CI's post-deploy poll (`release == github.sha`).
  **Build location decision**: Coolify-from-git (needs every build variable in Coolify, and
  the build competes with enrichment for VPS CPU) vs build in Actions, push to GHCR, Coolify
  pulls the image (recommended: the variables already live in Actions).
- **Runtime differences** [V]: the server bundle's only `node:` import is
  `node:async_hooks` (Bun supports it); `import.meta.env.DEV/PROD/BASE_URL/VITE_*` are
  build-time replacements and behave the same; server secrets already come from
  `process.env` (`env.ts:14`). The `cloudflare:workers` dynamic imports stay in the built
  chunks and fall back as R-3 lists (fail-open limiters, inline awaits).
- **Cloudflare in front** [I unless marked]: proxied A record, SSL Full (strict); Traefik
  needs a Cloudflare Origin CA cert or Let's Encrypt via DNS-01 (HTTP-01 can break behind the
  proxy); `supabase.` and `events.` presumably already do this but it is undocumented. Keep
  reading `cf-connecting-ip` (Traefik passes it through) and restrict the origin to
  Cloudflare IPs (firewall or Authenticated Origin Pulls). Cache rule: `hearted.music/assets/*`
  eligible, TTL from origin; `/_serverFn/*` and HTML bypass. The 100 s proxy timeout is
  irrelevant [V]: SSE lives on the gateway and no app request approaches it.
- **Cutover hazards** [V/I]: `wrangler.jsonc` binds `hearted.music` as a Worker custom
  domain, which must be removed before the A record can exist; until `deploy-app` is
  replaced, any push to main runs `bun run deploy` and **re-attaches the Worker domain**, so
  the CI job changes in the same change; rate limiting and Sentry are both off from the first
  Bun request unless fixed first (R-3). Rollback = delete the A record, re-add the custom
  domain; keep the Worker deployed but unrouted.

**Research findings (R-3, platform replacements).** Opus pass over the code and the
installed packages. [V] verified, [I] inferred.

- **Rate limiting → Postgres function (decision for open item 3).** Better Auth's limiter
  cannot be reused [V]: it is internal to `auth.handler`, keyed IP+path, read-then-update (two
  concurrent requests both pass), and it skips limiting entirely when no IP resolves. An
  in-process bucket resets on every deploy. Recommended: an `unlogged` `rate_limit_bucket(key,
  window_start, count)` table and a `rate_limit_hit(key, limit, window_s)` SQL function doing a
  single `INSERT … ON CONFLICT DO UPDATE … RETURNING count <= limit` (the row lock serialises
  concurrent hits; correct across replicas). Called through the shared `postgres` pool, not
  PostgREST. The job worker deletes rows older than an hour. **Decide fail-open vs fail-closed
  on DB error** (today's semantics are fail-open).
- **Better Auth once per process** [V]: the drizzle adapter only closes over `db`
  (transactions off by default); `tanstackStartCookies` resolves `setCookie` lazily from
  Start's per-request context [I: safe as a singleton]; nothing else in the config is
  request-scoped. `auth-request-state.server.ts` becomes a module-level pooled
  `postgres(max ≈ 5–10)` + one `betterAuth`; `close()`/`closeAuthRequestAfterResponse` and the
  `try/finally` in `auth-request-state.ts` go away; `AuthRequestState` shrinks to the
  per-request session memo. The 5-minute cookie cache was justified by the per-request
  TCP+TLS handshake; on a warm pool it is a real trade-off (revocation lag vs one indexed read
  per request) to decide. Fold `append-finalizer.ts`'s module-level `postgres({max:1})` into
  the same pool (on Bun it serialises every finalize).
- **Sentry on Bun** [V]: `@sentry/bun@10.53.1`'s `bunServerIntegration` wraps `Bun.serve`
  with per-request isolation scope, trace continuation and `captureException`, provided
  `Sentry.init` runs before `Bun.serve` (the worker's `bun --preload instrument.ts` is the
  in-repo precedent). **Server-fn errors are not captured today**: Start serialises them into
  the response, so `server.ts`'s catch never sees them and there is no `functionMiddleware`.
  Plan: a web `instrument.ts`, `Bun.serve({ fetch: handler.fetch })` called explicitly, a
  local `createMiddleware().server` capturing via `@sentry/core` in `functionMiddleware` and
  first in `requestMiddleware`, and `capture-server-error.ts`, `deck-view.ts`, `pulse-s.ts`
  switched to `@sentry/core` (add as a direct dependency; same 10.53.1). That also makes
  `captureServerError` safe in the worker and the injected reporter in
  `liked-song-access-grant.ts` optional.
- **`waitUntil`** [V]: sites `auth.server.ts:121-128` (heartbeat, already `void`),
  `auth-request-state.server.ts:182-193` (deleted by the singleton change),
  `posthog-server.ts:53-68` (flush; inline fallback adds latency to `billing-bridge.ts`), and
  the `env` binding in `edge-rate-limit.ts`. Replacement: one `runAfterResponse(p)` that
  tracks the promise in a module `Set` with a `.catch` → `captureServerError`, drained with a
  timeout on SIGTERM after `server.stop()` and before `Sentry.flush` (copy
  `gateway-entry.ts:37-42`). PostHog becomes one process-level client with batching and
  `shutdown()` on SIGTERM. Delete `src/cloudflare-workers.d.ts`, the test stub, and the
  Vite alias.
- **Client IP** [V]: `cf-connecting-ip` is read in `edge-rate-limit.ts:27` and
  `auth-request-state.server.ts:144`. With Cloudflare still in front (open item 2:
  recommended yes) the origin must accept only Cloudflare IPs or the header is spoofable;
  without it, read `x-forwarded-for`/`x-real-ip` from Coolify's Traefik, else Better Auth
  silently stops rate-limiting and every caller shares one `"unknown"` bucket.
- **Nothing else is Workers-only** [V]: `import.meta.env.PROD/DEV` are Vite build-time
  flags and stay correct; no `caches`, `request.cf` or `ExecutionContext` in `src/`. Build
  config to remove: the `cloudflare()` plugin, `@sentry/cloudflare` pre-bundling, the
  `preset: "node-ws"` line (effect unknown; see R-1), and `wrangler.jsonc`.

**Risks.** VPS headroom next to enrichment (check Coolify graphs; SSR is ~15 CPU-min/day at
today's volume, spikes are the concern). Single point of failure (already true for DB,
worker, gateway). Rollback = flip the DNS record back; keep the Worker deployed but unrouted
for a week.

**Done when.** `hearted.music` serves from the VPS; zero Worker invocations; a day without
5xx; a deliberately thrown server error reaches Sentry.

### #2 · Client reconnect/poll loops (R6)

**Problem.** F2.

**Decision.** Extract a pure `reconnectPolicy(state, event)` reducer from
`useAccountEvents.ts`; the hook keeps transport and cache updates only. Rules: token cached
until `exp − 30 s`, re-mint only on 401/expiry; no reconnects while `document.hidden`;
5xx/network error on the mint → floor 60 s, cap 5 min, jitter; stream close keeps the 2 s
floor; `useActiveJobs` fallback poll backs off exponentially and stops after 5 failures.
Tests at the reducer seam (the "28-hour loop" pin). **Effort M.**

**Harness re-run (decision 5).** One run of the same headless setup with
`page.on('requestfailed')`, `page.on('response')` filtered to `events.hearted.music`, and a
tracing capture of one `/dashboard` load. Outcomes: a preflight that never completes or a
`net::ERR_*` on the stream fetch = real connect bug; a harness flag like
`--disable-web-security` or blocked cross-origin streaming = test artefact. The gateway and
its CORS are healthy today (preflight 204 with the right headers).

### #3 · CPU-heavy work in the request path

After #1 this is latency and VPS load, not an outage.

| | Change | Effort | When |
|---|---|---|---|
| 3a | Profile one request of each kind on the Bun server; record numbers | S | right after #1 |
| 3a′ | Two cheap preview cuts found by R-2: skip `getSongEmbeddingsBatch` when there is no intent (behaviour change, `preview.test.ts` pins it); cache genre credit per distinct song genre in `scoreGenres` | S | with 3a, before 3b |
| 3b | **Preview ranking in Postgres** (design A, ~4–6 days per R-2) | L | next project after #1 |
| 3c | `betterAuth` and Supabase admin client once per process (R4) | M | with #1 |
| 3d | Sentry once per process, no 2 s flush | – | falls out of #1 |
| 3e/3f | eager auth chunk; analytics proxy off the app CPU | – | moot after #1 |

**3b decision rationale.** The studio is debounce-driven and expects a consistent answer per
round trip; a worker-maintained cache would make it eventually consistent with pins and
filters. Postgres already holds every input; one RPC replaces ten PostgREST pages, the JSON
parse of thousands of rows, and the in-process `matchBatch`. It matches the existing RPC
pattern (`get_liked_songs_page`, `start_or_resume_match_deck`) and the rule that DB-derived
id sets never re-enter as `.in()`. Keep `draft-engine.ts` as the reference and pin a parity
test: RPC order == TypeScript order on a seeded fixture. Intent embedding (`embedText`) stays
an app-server call (one vector).

**Research findings (R-2, ranking in Postgres).** Opus pass over migrations, types and the
scoring code. [V] = verified in code/migrations, [I] = inferred.

- **Schema is ready for it** [V]: pgvector enabled (`20260117000000_enable_vector.sql`, moved to
  the `extensions` schema in `20260330000002`); `song_embedding.embedding` is a real
  `extensions.vector(512)` with an HNSW `vector_cosine_ops` index
  (`20260610000000_qwen3_embeddings_512.sql`); `song.genres text[]`; `liked_song` indexed on
  `(account_id, liked_at DESC)`; `song_audio_feature` unique per song, all nine columns
  nullable. No scoring RPC exists today.
- **The one thing the DB does not have** [V]: genre similarity. It lives in
  `src/lib/domains/taste/genre-similarity/table.json` (482 genres, 9,106 directed pairs) and
  goes through `canonicalizeGenre` / `CANON_MAP` in `src/lib/integrations/lastfm/whitelist.ts`.
  Design A needs a `genre_similarity` + `genre_alias` table seeded from that JSON, versioned
  on `GENRE_TABLE_VERSION`, and an EXPLAIN on a 10 k library for the candidate-genres ×
  profile-genres join.
- **What the SQL must reproduce** [V]: hard filters (language primary-or-secondary, release
  year modes, half-open UTC liked-date ranges from a `p_now`, vocal gender; missing metadata
  fails an active filter); candidates = 10 k newest liked rows, cap applied *before* the
  Phase-1 check; profile from eligible candidates only (genre fractions blended 50/50 with
  pills, audio centroid ignoring nulls); audio score = weighted `1 − |diff|` with tempo/100
  and loudness/60; genre score = best banded credit per profile genre (1 exact, else
  min(r, 0.6), 0 below 0.3) weighted by mass; embedding = clamped cosine; z-score per signal
  over rows that have it, clip ±3, map `(z+3)/6`, 0.5 when std≈0, raw fallback when n < 8;
  fusion .5/.3/.2 or .35/.25/.40 with pills; "neutral" vs "redistribute" missing-signal
  policy; stable sort. Pinned extras count in z-stats but not in the profile or
  `totalEligible`. pgvector returns NaN for zero vectors where JS returns 0.
- **Contract**: RPC takes filters, pills, optional intent vector, `p_pinned`, `p_excluded`,
  `max_songs`, `offset`, `p_now`; returns pinned rows (scored even out of filter), the top
  `max_songs + offset + 12` ranked rows, `total_eligible` and `ranked_pool_count`.
  `composePlaylistPreview` stays in TypeScript but needs `ranked_pool_count` for its offset
  clamp.
- **Designs** [I]: (A) one SQL function, ~4–6 days, riskiest part = keeping the genre data in
  step with the JSON and the join cost. (B) per-account candidate table refreshed by the Bun
  worker, ~5–8 days, riskiest part = invalidation (genres/audio/language/year arrive later
  through enrichment); and it does **not** cut rows, because profile and z-stats need every
  eligible candidate, so TypeScript still scores up to 10 k. **A stays the decision.**
- **Two cheaper cuts before any port** [V/I]: `getSongEmbeddingsBatch` runs on every preview
  even without an intent (up to ~100 `.in()` requests for 10 k candidates; also the
  `.in()` rule violation; `preview.test.ts` pins this, so it is a behaviour change).
  `scoreGenres` lowercases and canonicalizes every song-genre × profile-genre pair; caching
  credit per distinct song genre (≤ 482) is probably the largest TypeScript-side CPU cut
  (unprofiled). Do both as 3a follow-ups; they shrink the request whether or not A ships.
- **Parity test**: `src/lib/domains/playlists/__tests__/preview-rank.integration.test.ts`
  modelled on `match-pairs.integration.test.ts` (postgres.js on local `DATABASE_URL`,
  `describeLocal` self-skip, fixed UUIDs); seeded PRNG library of 40–60 songs covering
  all-null audio, genre-only, audio-only, alias genres, null language/year, a few
  embeddings, so both the n ≥ 8 and n < 8 paths run; cases with/without pills, both
  policies, intent vector, each filter kind, an out-of-filter pin, excludes, an offset past
  the end; assert identical order and `total_eligible`, scores within 1e-9, RPC ordering
  `score DESC, liked_at DESC, song_id ASC` to match the stable sort; plus one hand-calculated
  3-song case so the reference is not validated only against itself. `src/test/fixtures.ts`
  has no genres/audio today and must be extended.

### #4 · "Nothing matches" on failure (R5)

**Problem.** F4.

**Decision.** `useCreatePlaylistDraft` returns one `previewState` union
(`loading | failed{retry} | empty{eligibleShortfall} | ready{isRefreshing, eligibleShortfall}`)
derived in `studioPreviewState.ts`; `StudioScreen` switches exhaustively; a new
`PreviewFailedState` (role alert, "Try again"). Test: query rejects → alert with retry, never
the empty-state copy. **Effort S–M.** Draft in `stash@{0}`.

### #5 · RPC client resolves non-OK JSON to `undefined` (R2, client half)

**Problem.** F5.

**Decision.** `src/start.ts` passes `serverFns.fetch` wrapping the global fetch: throw a
typed `ServerFnHttpError(status, bodyPreview)` when `!ok` and the response carries neither
`x-tss-serialized` nor `x-tss-raw` and is not a 404 (`notFound()` travels as a 404 JSON the
client must still parse; redirects travel as 200 JSON). Plus `lastPage?.nextCursor` in both
infinite option factories. Verified against the installed package: the option is client-only
(SSR calls server fns in-process), a thrown `Error` reaches loaders and TanStack Query
unchanged, and only a call-site or middleware `fetch` can bypass it (none exists). Report
upstream. **Effort S.** Draft in `stash@{0}`.

### #6 · Embedding provider never reached the Worker

**Problem.** F6.

**Decision.** After #1 the app reads the same Coolify env as the Bun worker: set
`ML_PROVIDER=deepinfra` and `DEEPINFRA_API_KEY` there. Make `ML_PROVIDER` required in
`src/env.ts` and delete the "which key exists" fallback in `providers/factory.ts` (R3). Add a
boot assertion in both runtimes: provider `(model, dims)` equals the distinct
`song_embedding.model/dims`. **Order: after 3b** — with the model matching, today's code
would load thousands of 512-float vectors per preview. **Effort S.**

### #7 · Nobody can see failures (R7)

Before #1 so the migration is observable: Cloudflare notification on Worker error rate
(interim); external uptime check on `hearted.music/health` and the gateway. After #1: Sentry
alert rules on server error volume and on `captureRouteError` volume; every degradation
branch goes through `captureServerError` (preview.ts embedding branches, `rankCandidates`,
`getLikedSongsPage` error path); `enableLogs` on for `error` level. **Effort S each.**

### #8 · Hydration mismatch from storage-backed state

**Problem.** F8.

**Decision.** Initialise `false`, read storage in an effect (one post-hydration flip).
**Effort S.** Draft in `stash@{0}`.

### #9 · Silent-empty error handling (R2, server half)

**Decision.** One boundary helper, `unwrapOrThrow(result, { area, operation, accountId })`,
that captures and throws a typed error. Migrate `getLikedSongsPage` (throw), `loadAuthSession`
(`unauthenticated | unavailable`, route renders retry for `unavailable`), `rankCandidates`
(moot after 3b), `useCreatePlaylistDraft` (#4). **Effort M.**

### #10 · Minor, now required by #1

| Item | Fix | Effort |
|---|---|---|
| Rate limiting (binding disappears; fallback is "allow everything") | per R-3 | S–M |
| Bot scans SSR'd as 404s | Cloudflare WAF rule for `/wp-*`, `/.env*`, `/xmlrpc.php`, `/.aws/*` | S |
| `getSongEmbeddingsBatch` `.in()` | removed by 3b | – |
| Route error components `handled: yes` | #7 | – |

### Refactors → cards

| Refactor | Implements | Effort |
|---|---|---|
| R1 App server as I/O orchestrator; ranking in Postgres | 3b, #6 ordering, #10 | L |
| R2 One server-fn boundary (server helper + client fetch guard) | #5, #9, #4 error path | M |
| R3 Explicit runtime config + boot assertions | #6 | S |
| R4 Per-process singletons (auth, Sentry, Supabase admin) | 3c, 3d | M, mostly falls out of #1 |
| R5 Query-state unions in hooks | #4 | S–M |
| R6 Pure reconnect reducer | #2 | M |
| R7 Observability contract | #7, #9 | S–M |

---

## Part C — Sequence and open decisions

**Before the move (all S, independent):** #7 interim alert + uptime check; #5; #8; #4.

**The move (one change, L):** #1 with #10 rate limiting, R4, Sentry swap; then #7
Sentry alerts and the R7 sweep.

**Right after:** #2 (R6) + harness re-run; 3a profile; #9 (R2 server half).

**Next project:** 3b (R1) with the parity test; #6 (R3) immediately after.

**Open decisions**

1. **Decided 2026-10-22: the app server goes on the existing Coolify VPS** (`tourflow-vps`,
   57.129.63.224, Tailscale alias in `~/.ssh/config`). Measured: 4 vCPU at 15–20 % busy,
   7.6 GB RAM with 4.2 GB available and 2 GB already swapped, disk 68 %, ~30 containers
   (full Supabase stack, Coolify, hearted worker ≈245 MB / 3 % CPU, gateway ≈50 MB), none with
   CPU or memory limits. Conditions: a memory limit (~768 MB) on the app container and
   limits on the worker; images built in Actions, not on the box (open item 5).
2. **Decided 2026-10-22: Cloudflare stays in front** (proxied record, WAF rule for bot
   paths, `/assets/*` cache rule), same as `supabase.` and `events.`. Implies: origin accepts
   only Cloudflare IPs so `cf-connecting-ip` cannot be spoofed; document how the two existing
   hosts terminate TLS behind the proxy and reuse it (open item 6).
3. **Decided 2026-10-22: in-process limiter in the app for all three endpoints, plus
   Cloudflare's single free rate-limiting rule on `/api/pulse-s`.** A second Opus pass
   (R-4) compared Cloudflare Free rules (1 rule, IP-only, 10 s window, no header/session
   key), Traefik's RateLimit middleware (needs Coolify label ownership, no session key), an
   in-process bucket, the Postgres function, and Redis. Facts that decided it: the token
   mint limit would not have stopped the 10-17 loop (≈4 mints/min across all users vs
   100/min per session; the fix is #2), the billing bridge must answer 503 not 429, the
   Sentry tunnel must work when the DB is down, and replicas are unrealistic on one VPS.
   The in-process limiter keeps `withinRateLimit(name, key)`'s signature, can't be
   unavailable, and resets at most one 60 s window on deploy. Postgres function stays as
   the fallback if replicas ever become a plan. Lock the origin to Cloudflare IPs regardless.
4. **Decided 2026-10-22: drop the 5-minute session cookie cache.** It existed only because
   Workers paid a TCP+TLS handshake per DB touch; on the pooled Bun server a session read is
   one indexed query. Logout and revocation take effect immediately.
5. **Decided 2026-10-22: build the app image in GitHub Actions and push to GHCR; Coolify
   pulls it.** Keeps the Vite build and the `VITE_*`/Sentry secrets in CI, off the VPS.
6. **Resolved 2026-10-22 by inspection:** Coolify's Traefik (`coolify-proxy`) uses the
   `letsencrypt` resolver with the HTTP-01 challenge on entrypoint `http`, and
   `/data/coolify/proxy/acme.json` already holds certificates for `supabase.`, `events.` and
   `billing.hearted.music`, all issued behind the Cloudflare proxy. `hearted.music` reuses
   exactly that: add the domain to the Coolify service and Traefik issues the cert. No
   Origin CA cert, no DNS-01.
7. **Resolved 2026-10-22 without a harness: the SSE stream is blocked by the app's own
   Content-Security-Policy, for every user, since the gateway shipped.** All three CSP
   variants in `src/routes/__root.tsx` set `connect-src 'self' https://*.userjot.com`
   (the directive dates from 2026-05-19; the gateway target `events.hearted.music` was
   introduced 2026-07-09 and never added). The live header confirms it. Evidence lines up:
   zone analytics never show a single request (not even a CORS preflight) to
   `/account-events/stream`; Sentry breadcrumbs show token mint → stream fetch with no
   status (the signature of a CSP-rejected fetch) → mint again 2 s later, backing off to the
   30 s cap. So in production SSE has never connected, every open tab mints a token every
   15–30 s forever, and every user runs on the `getActiveJobs` polling fallback. This is the
   bulk of the app's baseline request volume. Fix is one line (add the gateway origin to
   `connect-src`, driven by `VITE_ACCOUNT_EVENTS_GATEWAY_URL`) plus a test that the CSP
   allows the configured gateway; it ships with #2.

---

## Appendix — reproduction notes

- Cloudflare GraphQL: `workersInvocationsAdaptive` filtered on `scriptName:"hearted-music"`
  (dimensions `datetimeMinute/status`, `quantiles.cpuTimeP50/P99` in µs, `max.cpuTime`); zone
  `httpRequestsAdaptive` with `clientRequestPath_like:"%serverFn%"`. Token in
  `~/.config/.wrangler/config/default.toml`; run `wrangler whoami` first to refresh it.
- Server-fn hash → name: `dist/server/assets/__23tanstack-start-server-fn-resolver-*.js`
  (`9b2a3e80` previewPlaylistDraft, `67ea3afd` getAccountEventsToken, `b5882e5b`
  getActiveJobs, `f9aa4d60` getLikedSongsPage, `cffb20be` getPlaylistTracksPage).
- RPC probe: `/tmp/hearted-probe/rpc-503c.ts` (runs `serverFnFetcher` inside
  `runWithStartContext` with fake 503 responses).
- Sentry: `sentry issue list f-inc/hearted-music --period "2026-10-17..2026-10-18"`;
  `sentry event view f-inc/hearted-music <id> --json` for breadcrumbs.
- Draft code for #4, #5, #8: `git stash list` → `stash@{0}`; `git stash show -p stash@{0}`.
