# Reliability plan: the 2026-10-17 outage and the move off Workers

The single working plan for hearted.music reliability. Every item was re-checked against `main` on
2026-10-27. Nothing below is implemented yet unless marked.

## Background

**What happened.** On 2026-10-17 (15:37–15:43 UTC) a headless-browser test made logged-in page loads
return Cloudflare Error 1102 / HTTP 503, and failures continued for ~28 h after the test stopped. On
2026-10-21 one studio run showed "Nothing matches" because its preview request was killed.

**Why.** The app runs on Workers Free, which allows 10 ms CPU per request. Every authenticated request
already spends ~10 ms on fixed setup (Sentry `init()` per request, a fresh `betterAuth()` per request,
cold-isolate compile of the ~870 KB auth chunk). Cloudflare tolerated occasional overruns until the test
raised volume ~10×; then it enforced the limit and killed requests at exactly 10.000 ms CPU, including
trivial ones. Open tabs kept the load up: the CSP blocks the SSE gateway, so every tab re-minted a token
every 15–30 s and polled `getActiveJobs` (sections 1.1, 1.2). The studio preview, the heaviest request,
uses 400–540 ms CPU (section 4).

**How it was established.** Cloudflare GraphQL analytics (`workersInvocationsAdaptive` per-minute
status and CPU quantiles; zone `httpRequestsAdaptive` per path/status/Ray ID), Cloudflare script
settings (`limits: null`, smart placement), `wrangler secret list`, the Sentry CLI, one read-only prod
aggregate of `song_embedding` models, and a Bun probe of the TanStack Start RPC client. Ruled out:
memory limit, code regression (no deploy since 2026-10-08), payload size, viewport width.

**Re-running the queries.**
- Cloudflare GraphQL with the wrangler OAuth token (`~/.config/.wrangler/config/default.toml`; run
  `wrangler whoami` first). Account `9181203e8719e8064ea2692a0b8e1591`, zone
  `7e80ca7d41814d5a94b55daab2b5f11d`. `workersInvocationsAdaptive` filtered on
  `scriptName:"hearted-music"` (dimensions `datetimeMinute`/`status`, `quantiles.cpuTimeP50/P99` in µs,
  `max.cpuTime`); zone `httpRequestsAdaptive` with `clientRequestPath_like:"%serverFn%"`.
- Server-fn hash → name: `dist/server/assets/__23tanstack-start-server-fn-resolver-*.js`.
- Sentry: `sentry issue list f-inc/hearted-music --period "2026-10-17..2026-10-18"`.

**Already landed.** Studio failed state (`c71bad4a`), server-fn transport errors reject instead of
resolving to `undefined` (`c2b41a30`), dismissed-banner hydration (`5275f7df`).

**Earlier write-ups**, removed from the tree once folded in here, still readable from git:
- Full diagnosis and research (R-1 hosting, R-2 ranking in Postgres, R-3 platform replacements):
  `git show 4da1e807:docs/tmp/reliability-2026-10-21.md` (also `investigation-1102-2026-10-21.md`).
- Audit follow-up analysis and PR review behind section 5:
  `git show 4da1e807:docs/tmp/audit-followup-deep-refactor.md`,
  `git show 4da1e807:docs/tmp/pr-review-audit-followup.md`.

Effort: **S** < ½ day · **M** 1–2 days · **L** 3–5 days.

**How this ships.** Everything here is done as one push, with the move off Workers (section 3) at its
centre. There are no active users, so there is no interim period to protect: no stopgaps, no
Workers-only mitigations, and the cutover needs no traffic choreography. Sections 1, 2 and 4 are
independent of the hosting and can be built before or alongside section 3.

---

## 1. Live updates and request loops

These matter on the VPS too: SSE being blocked is why the dashboard can't react to finished jobs (2.4),
and the loops are most of the app's baseline request volume.

### 1.1 Allow the SSE gateway in the CSP — S

- **Problem.** The CSP `connect-src` lists only `'self' https://*.userjot.com`, so the browser blocks
  every connection to `events.hearted.music`. SSE has never connected in production; every tab falls
  back to re-minting tokens and polling.
- **Where.** `src/routes/__root.tsx:263`, `:295` (and the third variant near `:233`).
- **Change.** Add the gateway origin to `connect-src`, derived from `VITE_ACCOUNT_EVENTS_GATEWAY_URL`
  (`src/env.ts:71`). Add a test that the CSP allows the configured gateway.
- **Verify in prod.** After deploy, one dashboard load shows a `200` streaming request to
  `events.hearted.music/account-events/stream` and the connection state reaches `connected`. This
  replaces the planned headless-harness re-run: the CSP explains the
  failed connects.

### 1.2 Reconnect and polling back-off (#2) — M

- **Problem.** `useAccountEvents` mints a new token on every connect attempt
  (`src/lib/hooks/useAccountEvents.ts:279`), caps back-off at 30 s (`:26`), keeps retrying in hidden
  tabs, and treats a 5xx like a normal stream close. `useActiveJobs` polls every 15 s (5 s with an active
  job) whenever SSE is not connected, forever (`src/lib/hooks/useActiveJobs.ts:14-15,30`). Together
  these kept the outage going for ~28 h.
- **Change.** Extract a pure `reconnectPolicy(state, event)` reducer; the hook keeps transport and cache
  updates only.
  - Reuse the token until `exp − 30 s`; re-mint only on 401 or expiry.
  - No reconnects while `document.hidden`; resume on `visibilitychange`.
  - 5xx or network error on the mint: floor 60 s, cap 5 min, with jitter.
  - Stream close keeps the 2 s floor.
  - `useActiveJobs` fallback poll backs off exponentially and stops after 5 consecutive failures.
- **Test.** At the reducer seam: a regression test for the 28-hour loop.

---

## 2. Correctness bugs

### 2.1 Errors that look like "no data" (#9) — M

- **Problem.** Failures are shown to the user as empty or wrong content instead of an error:
  - Liked songs: a DB error returns `{ songs: [], nextCursor: null }`, so the library looks empty
    (`src/lib/server/liked-songs.functions.ts:133`).
  - Login: `loadAuthSession` returns `null` when the DB is down, so the user looks logged out
    (`src/lib/platform/auth/auth.server.ts:72-83`).
  - Studio ranking: a `matchBatch` failure returns every candidate with score 0
    (`src/lib/domains/playlists/draft-engine.ts:230-237`).
  - Embedding failures are `console.error` only, never reach Sentry
    (`src/lib/workflows/playlist-studio/preview.ts:150,164,173`).
- **Change.** One server-fn boundary helper, `unwrapOrThrow(result, { area, operation, accountId })`,
  that reports through `captureServerError` and throws a typed error.
  - Liked songs: throw; the list renders an error with retry.
  - Login: `loadAuthSession` returns `unauthenticated | unavailable`; `unavailable` renders a retry, not
    the login page.
  - Studio ranking: report the failure (moot once ranking moves to Postgres, 4.4).
  - Embedding branches: report through `captureServerError`.
- **Done** except the embedding branches (`preview.ts`, still open). Helper:
  `src/lib/server/unwrap-or-throw.ts` (`unwrapOrThrow`, `reportAndThrow`, `ServerFnError`). Login:
  `getAuthSessionState()`; `getAuthSession()` throws `AuthUnavailableError` on `unavailable`, so
  `authMiddleware` and the `_authenticated` guard fail with a retry screen instead of redirecting to
  sign-in.

### 2.2 Match results cut off at 1,000 rows — S

- **Problem.** `getMatchResults` reads a whole snapshot in one request with no paging
  (`src/lib/domains/taste/song-matching/queries.ts:112`). PostgREST caps responses at `max_rows`
  (1,000 locally, `supabase/config.toml:18`). A larger snapshot is silently truncated and
  suggestions go missing. Callers: `match-review-queue/service.ts:154,246`,
  `eligible-subjects.ts:99`.
- **Confirmed live in prod (2026-10-27).** Prod REST returns exactly 1,000 rows per request
  (`max_rows` = 1,000), and the largest `match_result` snapshot has ~9,600 rows, so ~89 % of that
  snapshot was being dropped.
- **Change.** Page with `.range()` until exhausted, or replace with an RPC.
- **Done.** `getMatchResults` pages with `.range()` (page size = `max_rows`) until a short page;
  all three callers read through it unchanged. Pinned by
  `song-matching/__tests__/get-match-results.paging.test.ts` against a fake capped at 1,000 rows.

### 2.3 Suggestions disappear when the playlist-name read fails — S

- **Problem.** `getSongSuggestions` reads playlist names and ignores the error; a failed read makes
  every suggestion vanish (`src/lib/server/matching.functions.ts:158-171`). It also feeds DB-derived
  ids back as `.in()` (project rule). Not a security issue: the ids come from the account's own
  suggestions.
- **Change.** Check the error and surface it; join the names in the query that produces the
  suggestions instead of a second `.in()` read.
- **Done.** `get_match_pairs_for_song` returns `playlist_name` / `playlist_spotify_id`
  (migration `20261027100000`); the song path of the visible-suggestion list hands them back, and
  `getSongSuggestions` throws (reported) on any read failure instead of returning `null`. The panel
  still has no distinct error state: a failed query just omits the section, but it is no longer
  cached as "no suggestions".

### 2.4 Recent Activity doesn't update after "Sync new songs" — S–M

- **Problem.** After a sync, Recent Activity (the newest liked songs) only shows new songs after a page
  refresh. Two causes:
  1. The dashboard refreshes too early. `useDashboardSync` invalidates the dashboard queries as soon
     as the extension reports success (`src/features/dashboard/hooks/useDashboardSync.ts:218-220`),
     but that success is the 202 from `/api/extension/sync`, which only enqueues the work
     (`src/routes/api/extension/sync.tsx:15-16,235`). The worker hasn't written the new liked songs
     yet, so the refetch returns the old list.
  2. Nothing refreshes it later. The only later refresh is the SSE `enrichment_completed` event
     (`src/lib/hooks/useAccountEvents.ts:93-109,234`), and SSE never connects (item 1.1). The polling
     fallback only reacts to a match-snapshot refresh finishing
     (`src/lib/hooks/useActiveJobs.ts:83-92`), and that invalidation set leaves out
     `recentActivity` (`src/lib/query-keys.ts:156-200`). No account event exists for "sync finished".
- **Change.** Refresh the dashboard when the server-side sync job finishes, not when it is accepted:
  - Emit an account event when the extension-sync job completes and invalidate the dashboard keys on
    it (works once 1.1 lands).
  - Track the sync job in the polling fallback too (`getActiveJobs` + `useActiveJobCompletionEffects`)
    and invalidate on its running→done edge, so it works without SSE.
- **Test.** Hook-level: the sync job's completion edge invalidates `dashboardKeys.recentActivity`; the
  202 alone does not count as done.

---

## 3. Move the app server to the VPS (#1) — L

The web app leaves Cloudflare Workers and runs as a Bun container on the Coolify VPS next to the job
worker and the SSE gateway. Cloudflare stays in front (DNS, WAF, asset cache). Removes the 10 ms
CPU-per-request limit of Workers Free, which every authenticated request was already at.

**Decisions (taken 2026-10-22, confirmed 2026-10-27).**

1. Host: existing VPS `tourflow-vps` (15–20 % CPU busy, 4.2 GB RAM free). Memory limit ~768 MB on the
   app container; add limits on the worker too.
2. Cloudflare stays in front (proxied record); the origin accepts only Cloudflare IPs, so
   `cf-connecting-ip` can't be spoofed.
3. Image built in GitHub Actions, pushed to GHCR; Coolify pulls it. No builds on the VPS.
4. Rate limiting: in-process limiter in the app for the rate-limited endpoints, plus Cloudflare's one free
   rate-limiting rule on `/api/pulse-s`.
5. Drop the 5-minute session cookie cache: logout and revocation take effect immediately.
6. TLS: same Let's Encrypt (HTTP-01) setup Traefik already uses for `supabase.`, `events.`, `billing.`.

### 3a. Bun server entry and image

- `Dockerfile.app` (only `Dockerfile.worker` exists): build stage runs `RELEASE=true vite build` with the
  `VITE_*`, `SENTRY_AUTH_TOKEN`, `VITE_APP_RELEASE` values from CI; runtime stage with production
  dependencies, `dist/`, the entry. Own `.dockerignore` (the shared one excludes `vite.config.ts`,
  `public`, `scripts`).
- A ~40-line Bun entry: `Bun.serve({ idleTimeout: 120, fetch: handler.fetch })` serving `dist/client`
  itself (the Start server doesn't): hashed `/assets/*` as `immutable`, other public files with a short
  max-age. The HSTS and Permissions-Policy headers in `public/_headers` (Workers-only) move into it.
- The build must fail when `VITE_PUBLIC_APP_ORIGIN` or `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` is missing
  (today a missing value builds green and every request 500s).
- Healthcheck on `src/routes/health.ts` (already returns `release`).

### 3b. Sentry on Bun

- `src/server.ts:1,73` wraps the handler in `@sentry/cloudflare`'s `withSentry`, which is silently inert
  under Bun. Replace with an `instrument.ts` preload (`@sentry/bun`, one `init` per process, no 2 s
  flush per request), like the worker.
- Switch `capture-server-error.ts`, `deck-view.ts`, `liked-song-access-grant.ts`, `routes/api/pulse-s.ts`
  to `@sentry/core`.
- New: server-fn errors are reported. Start serialises them into the response, so nothing captures them
  today. Add a `createMiddleware().server` capture in `functionMiddleware` and first in
  `requestMiddleware`.

### 3c. Remove Workers-only code

- `waitUntil` sites (`auth.server.ts:123`, `auth-request-state.server.ts:188`, `posthog-server.ts`) →
  one `runAfterResponse(promise)` helper: tracked in a module `Set`, errors to `captureServerError`,
  drained on SIGTERM after `server.stop()` and before `Sentry.flush`.
- PostHog: one process-level client with batching, `shutdown()` on SIGTERM.
- Remove `src/cloudflare-workers.d.ts`, `src/test/cloudflare-workers.stub.ts` and its Vite alias, the
  `cloudflare()` Vite plugin, the ignored `preset: "node-ws"` (`vite.config.ts:336`), `wrangler.jsonc`.

### 3d. Rate limiting

- `withinRateLimit` (`src/lib/platform/rate-limit/edge-rate-limit.ts`) returns `true` when the Workers
  binding is missing (`:43,47`), so on Bun all three callers would be unlimited: token mint
  (`account-events.functions.ts:12`), `routes/api/billing-bridge.ts:73`, `routes/api/pulse-s.ts:306`.
- Waitlist signup (`src/lib/server/waitlist.functions.ts:18-54`) inserts and sends email with no limiter
  at all; add it as a fourth caller.
- Replace with an in-process fixed-window limiter keeping the `withinRateLimit(name, key)` signature.
  Billing bridge must answer 503, not 429, when it limits.
- Client IP: keep `cf-connecting-ip`, valid only because the origin is locked to Cloudflare IPs.

### 3e. One instance per process

- `auth-request-state.server.ts:43,84` opens a `postgres()` connection and builds `betterAuth()` per
  request. Make both module-level (pool `max` ≈ 5–10); remove the per-request close and its
  `try/finally`; `AuthRequestState` shrinks to the per-request session memo.
- Remove `cookieCache` (`:93`), per decision 5.
- Fold `append-finalizer.ts`'s own `postgres({ max: 1 })` into the shared pool.
- Supabase admin client once per process.

### 3f. CI and cutover

- `deploy-app` (`.github/workflows/main.yml:292-337`) runs `bun run deploy` on every push to `main`,
  which would re-attach the Worker custom domain. Replace it in the same change: build, push to GHCR,
  POST a Coolify deploy hook like the worker's (`:404-405`), poll `/health` until `release == github.sha`.
- Coolify env for the app from the same source as the worker (fixes the missing-secrets class of bug).
- Path filters for the new app job: see `docs/plans/hardening-backlog.md` §4.2 (the current filter
  misses `src/server.ts`, `start.ts`, `router.tsx`, `styles.css`, `env.public.ts`).
- Cutover: remove the Worker custom domain, add the proxied A record → VPS, cache rule on
  `hearted.music/assets/*` (bypass `/_serverFn/*` and HTML), WAF rule for `/wp-*`, `/.env*`,
  `/xmlrpc.php`, `/.aws/*`, origin firewall to Cloudflare IPs.
- Rollback: delete the A record, re-add the custom domain. Keep the Worker deployed but unrouted until
  the VPS meets "done when".

### 3g. Explicit embedding provider — S

- **Context.** `DEEPINFRA_API_KEY` was added to the Worker secrets on or before 2026-10-27, so intent
  embeddings already work there; the VPS env must carry it over.
- **Problem.** `ML_PROVIDER` is optional (`src/env.ts:35`) and skipped by the secrets sync
  (`scripts/ops/env-to-secrets.ts:22`). The provider is picked by which key happens to exist
  (`src/lib/integrations/providers/factory.ts:38-52`); if `DEEPINFRA_API_KEY` goes missing, the app
  silently falls back to anonymous HuggingFace (401 on every call, wrong model).
- **Change.**
  - Set `ML_PROVIDER=deepinfra` and `DEEPINFRA_API_KEY` in the VPS env, same source as the Bun worker.
  - Make `ML_PROVIDER` required in `src/env.ts`; delete the "which key exists" fallback in the factory.
  - Boot assertion in the app and the worker: the provider's `(model, dims)` equals the distinct
    `song_embedding` model/dims; refuse to start otherwise.

### 3h. Observability (#7) — S

- **Problem.** Failures were invisible: a CPU-limit kill ended the isolate before Sentry captured
  anything (5 Sentry issues vs ~2,100 kills), server `console.error` is discarded
  (`src/server.ts:81` `enableLogs: false`), and no alert or uptime check exists.
- **Change.**
  - External uptime check on `hearted.music/health` and the SSE gateway.
  - Sentry alert rules on server error volume and on `captureRouteError` volume.
  - `enableLogs` on for `error` level.
  - Every degradation branch reports through `captureServerError` (covered by 2.1).
  - Route error components report `handled: no`.

**Done when.** `hearted.music` serves from the VPS; zero Worker invocations; a day without 5xx; a
deliberately thrown server error reaches Sentry; the uptime check is green.

---

## 4. Studio preview performance

After section 3 a slow preview is latency and VPS load, not an outage. Today every preview loads up to
10 k liked songs (`PHASE1_CANDIDATE_CAP`, `src/lib/domains/playlists/candidate-loader.ts:29`) over
~10 PostgREST pages and scores all of them in the app (`rankCandidates` → `matchBatch`): 400–540 ms CPU.

### 4.1 Profile on the Bun server — S, right after section 3

- Profile one request of each kind (SSR page, cheap server fn, studio preview) and record the numbers
  here, so 4.3 and 4.4 are judged against measurements, not code reading.
- **Done (2026-10-28, release `1de04576`, after 4.2 and 4.3).** Two measurements on the VPS app
  container, both read-only against prod:
  - *HTTP replay.* 20 sequential requests per kind from the VPS host straight to the container
    (bypassing Cloudflare/Traefik) with a logged-in session, 803-song library. CPU is the bun process's
    `/proc` utime+stime delta per request minus the idle background rate (~15–25 ms/s); wall is
    curl `time_total`, p50.

    | Request | CPU / req | Wall p50 |
    | --- | --- | --- |
    | `getActiveJobs` (cheap server fn) | 37 ms | 55 ms |
    | SSR `/dashboard` | 83 ms | 115 ms |
    | SSR `/playlists/new/studio` (streams the preview) | 133 ms | 151 ms |
    | `previewPlaylistDraft`, no intent | 68 ms | 91 ms |
    | `previewPlaylistDraft`, intent | 185 ms | 300 ms |

  - *In-process.* `runPreviewPlaylistDraft` timed with `process.cpuUsage()` inside the container
    (2 warm-up + 10 runs, medians), for the profiled account and the three largest libraries. Two of
    those are not intent-eligible, so their "intent" run equals no-intent.

    | Eligible candidates | No intent: CPU / wall | Intent: CPU / wall |
    | --- | --- | --- |
    | 791 | 43 / 66 ms | 97 / 259 ms |
    | 1,240 | 87 / 379 ms | not eligible |
    | 3,000 | 101 / 361 ms | not eligible |
    | 4,477 | 160 / 699 ms | 510 / 1,160 ms |

- **Reading.** On Bun the preview is a latency problem, not a CPU one: for the largest library the
  no-intent wall time is ~4× its CPU time, i.e. dominated by the paged PostgREST candidate reads.
  The intent path adds the 512-float vector read and parse per candidate (+350 ms CPU at 4.5 k).
  Both are what 4.4 removes. The ~37 ms CPU of a trivial authenticated server fn is the fixed
  per-request floor (auth, Start, Sentry) and is not addressed by section 4.

### 4.2 No prompt → no embedding read — S

- **Problem.** Since `DEEPINFRA_API_KEY` was added, the provider model (`Qwen/Qwen3-Embedding-0.6B`,
  512-d, `src/lib/integrations/providers/adapters/deepinfra.ts:50`) matches the stored `song_embedding`
  rows, so every preview fetches and parses a 512-float vector per candidate (up to 10 k) through chunked
  `.in()` reads (`src/lib/domains/enrichment/embeddings/queries.ts:115-120`, called at
  `src/lib/workflows/playlist-studio/preview.ts:139-142`). Without an intent the matcher runs in
  no-embedding mode and never uses them (`src/lib/domains/playlists/draft-engine.ts:171-193`).
- **Change.** Skip `getSongEmbeddingsBatch` when `effectiveIntent` is null. `preview.test.ts` pins the
  always-read behaviour; update it on purpose and say so in the commit. With an intent the vectors are
  still read until 4.4 moves the similarity into SQL.

### 4.3 Cache genre credit per distinct genre — S

- **Problem.** `scoreGenres` (`src/lib/domains/taste/song-matching/service.ts:94`) lowercases and
  canonicalizes every song-genre × profile-genre pair on every call
  (`src/lib/domains/taste/genre-similarity/loader.ts:44-57`).
- **Change.** Compute credit once per distinct song genre per preview (at most 482). Likely the largest
  TypeScript-side cut; unmeasured until 4.1.

### 4.4 Rank the preview in Postgres — L (~4–6 days)

- **Change.** One SQL function does hard filters, candidate cap, profile, per-signal scoring, z-score
  normalisation, fusion and stable sort, and returns only the pinned rows plus the top
  `max_songs + offset + 12` with `total_eligible` and `ranked_pool_count`. Replaces the ~10 page reads,
  the row parsing and the in-app `matchBatch`. Intent similarity is computed in SQL
  (`1 − (embedding <=> intent)` joined to the account's liked songs), so stored vectors never leave the
  DB and the last `.in()` read of DB-derived ids (`getSongEmbeddingsBatch`) goes away.
  `composePlaylistPreview` stays in TypeScript. Intent embedding (`embedText`, one vector) stays an app
  call. `draft-engine.ts` stays as the reference implementation.
- **Inputs.** Filters, pills, optional intent vector, `p_pinned`, `p_excluded`, `max_songs`, `offset`,
  `p_now`.
- **Missing in the DB.** Genre similarity lives in
  `src/lib/domains/taste/genre-similarity/table.json` (482 genres, 9,106 directed pairs) plus
  `CANON_MAP` in `src/lib/integrations/lastfm/whitelist.ts`. Needs `genre_similarity` + `genre_alias`
  tables seeded from them, versioned on `GENRE_TABLE_VERSION`, and an EXPLAIN on a 10 k library for the
  candidate-genre × profile-genre join.
- **Behaviour to reproduce exactly** (from the R-2 research): missing metadata fails an
  active filter; cap applied before the Phase-1 check; profile from eligible candidates only; pinned
  extras count in z-stats but not in the profile or `total_eligible`; raw-score fallback when n < 8;
  both missing-signal policies; order `score DESC, liked_at DESC, song_id ASC`; pgvector NaN on zero
  vectors vs JS 0.
- **Parity test.** `src/lib/domains/playlists/__tests__/preview-rank.integration.test.ts`: seeded
  40–60-song library (all-null audio, genre-only, audio-only, alias genres, null language/year, some
  embeddings) so both the n ≥ 8 and n < 8 paths run; cases with/without pills, both policies, intent,
  each filter kind, an out-of-filter pin, excludes, offset past the end. Assert identical order and
  `total_eligible`, scores within 1e-9, plus one hand-calculated 3-song case. Extend
  `src/test/fixtures.ts` with genres and audio features.

---

## 5. Code cleanup (not part of the reliability push)

Left over from the October audit follow-up; everything else from that audit landed in
PRs #33–#38. No user-facing bug; can run in parallel with the push (no shared files with sections 1–4
except 5.1's `matching.functions.ts`, which 2.3 also touches; do 2.3 first).

### 5.1 One loader for match-visibility inputs (audit Module A) — L

- **Problem.** The pure `passesVisibilityPolicyForPair` (`visibility-policy.ts`) is fed by three
  assemblers that each gather pairs, decisions, entitlement, ownership, song metadata and playlist
  filters: `match-review-queue/service.ts` (~`:135-188`, `:233-290`), `eligible-subjects.ts`,
  `visible-suggestion-list.ts`. They feed DB-derived ids back through chunked `.in()`
  (`filter-metadata-queries.ts:103,111,149`, `queries.ts:476`, `visible-suggestion-list.ts:304`),
  which the project rules forbid. Duplicates: `fetchOwnedPlaylistIds` twice (`queries.ts:462`,
  `visible-suggestion-list.ts:290`). The copies disagree: subject derivation reads filters only for
  `is_target` playlists (`queries.ts:950`), the card path for any playlist in the pairs.
- **Change.** `match-review-queue/visibility-inputs.ts`:

  ```ts
  /** Everything the visibility policy needs about one account's match pairs, joined in SQL so no DB-derived id re-enters a query. */
  export function loadVisibilityInputs(
    supabase: SupabaseClient,
    scope: { accountId: string; snapshotId: string } &
      ({ kind: "account" } | { kind: "song"; songId: string } | { kind: "playlist"; playlistId: string }),
  ): Promise<Result<VisibilityInputs, DbError>>;
  ```

  Backed by one set-returning RPC paged with `.range()`, decoded through `fromSupabaseRpc`. Filters stay
  jsonb and are evaluated by the pure policy; the RPC only joins. `hasFirstVisibleReviewSubject` keeps
  its signature.
- **Deletes.** `filter-metadata-queries.ts` (163 lines), both `fetchOwnedPlaylistIds`,
  `fetchTargetPlaylistFilters` (`queries.ts:942`), `fetchEntitledSongIds` and `checkPlaylistOwned`
  (`visible-suggestion-list.ts:265,320`), the `Promise.all` fan-outs, and the unused
  `minScoreOverride` (`service.ts:138,236`).
- **Decide first.** Filter source: every playlist that appears in the pairs (recommended; removes the
  `is_target` disagreement) vs `is_target` only. Confirm pairs only exist for target playlists.
- **Tests.** One `visibility-inputs.integration.test.ts` against real Postgres; the mocked-query halves of
  `visible-suggestion-list.test.ts` and `service.test.ts` and `filter-metadata-queries.test.ts` become
  redundant. Pure policy tests stay.
- Supersedes 2.2's paging for these callers if it lands first: `getMatchResults`' callers in
  `service.ts` and `eligible-subjects.ts` move onto the loader.

### 5.2 Typed deck-job payload (audit E4) — S

- **Problem.** The deck-job payload is written untyped (`src/worker/poll-match-deck-jobs.ts:211`
  `payload: { snapshotId } as Json`; `match-review-queue/proposal-rebuild.ts:26`), typed as `Json` on
  `EnqueueDeckJobInput.payload` (`match-review-queue/deck-jobs.ts:240`), and read back by a hand
  decoder (`payloadSnapshotId`, `poll-match-deck-jobs.ts:61`).
- **Change.** One `DeckJobSpec` Zod schema keyed by job kind, owned next to `deck-jobs.ts`; the
  enqueue input takes it typed, the worker decodes with it, and `payloadSnapshotId` goes away. Was
  blocked on the worker-outcome refactor, which merged in #33.

### 5.3 Release-year counts copy the entitlement predicate — S

- **Problem.** `get_account_release_year_counts`
  (`supabase/migrations/20260713000000_account_release_year_counts_rpc.sql`) re-implements the
  entitled-song predicate (reads `account_billing.unlimited_access_source` itself) instead of calling
  `select_entitled_data_enriched_liked_song_ids`, so a change to who is entitled must be made twice.
  Caller: `src/lib/domains/library/liked-songs/taste-profile-queries.ts:224`. Flagged in the #35
  review.
- **Change.** New migration (expand-only, `CREATE OR REPLACE`) that selects from
  `select_entitled_data_enriched_liked_song_ids`, as `get_account_match_filter_options` already does.
  Integration test: counts equal for subscription, self-hosted and locked accounts.

---

## 6. Order of work

One push, built in this order so each step can be tested on its own:

1. Sections 1, 2, 4.2, 4.3 (no dependency on hosting).
2. Section 3 (the move), including 3g and 3h.
3. 4.1 profile on the VPS, then 4.4 ranking in Postgres.
4. Section 5 alongside, in any order (2.3 before 5.1).

Also, outside the code: report the RPC-client bug behind the landed #5 fix upstream to TanStack Start
(`serverFnFetcher.getResponse` treats any `application/json` body lacking `x-tss-serialized` as a success
envelope, so a 503 JSON body resolves the server fn to `undefined` while 503 HTML/text throws; still
present in 1.170.38), so the local `guarded-fetch.ts` guard can go away when it's fixed.
