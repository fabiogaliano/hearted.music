# Investigation: Cloudflare Error 1102 on hearted.music (2026-10-17/18)

Date: 2026-10-21 · Read-only. No code, config, deploy, or data changes.

## TL;DR

The Worker is on the **Workers Free plan's 10 ms CPU-per-request limit**, and
almost every authenticated request uses about 10 ms of CPU just on fixed
per-request work (Sentry init, Better Auth construction, session/account
lookup, TanStack Start request pipeline), before doing anything specific to the
route. Cloudflare tolerated the overruns until the 2026-10-17 headless test
pushed volume up about 10×. After that it started enforcing the limit, and
requests began dying at exactly 10.0 ms CPU. That included trivial ones like
`getActiveJobs` and `getAccountEventsToken`, not just the heavy pages. A
client-side retry/poll loop (SSE token re-mint plus `getActiveJobs` polling
while SSE is down) kept volume high for about 28 hours after the test ended,
so the failures kept going until about 2026-10-18 19:00 UTC.

This is **not** caused by a heavy route, a large SSR payload, or the
790-song library. Payloads are small and paginated.

## What I could access

| Source | Access | Notes |
|---|---|---|
| Sentry (`sentry` CLI v0.44.1, org `f-inc`, project `hearted-music`) | Yes | Only client-side symptoms. No server events: a 1102 kills the isolate before the SDK can report |
| Cloudflare GraphQL Analytics (wrangler OAuth token) | Yes | `workersInvocationsAdaptive` (per-minute status + CPU quantiles), zone `httpRequestsAdaptive[Groups]` (per path/status/ray) |
| Cloudflare script settings API | Yes | `usage_model: standard`, `limits: null`, smart placement, observability logs on (sampling 1.0), traces off |
| Workers Observability telemetry API (per-request logs) | **No** | `Authentication error`, because the wrangler OAuth token lacks the observability scope |
| Account subscriptions/billing API | **No** | `Authentication error` |
| PostHog | Not queried | `.env*` reads are blocked by a local guard hook. PostHog wasn't needed given the CF data |
| Repo `.env*`, `.dev.vars` | Blocked by hook | Not needed |

## Evidence

### 1. The failures are a 10 ms CPU cutoff

`workersInvocationsAdaptive`, script `hearted-music`, 2026-10-17 (CPU in ms):

| minute | status | reqs | CPU p50 | CPU p99 | wall p50 |
|---|---|---|---|---|---|
| 15:36 | exceededResources | 15 | **10.0** | 33 | 132 ms |
| 15:36 | success | 175 | 9.2 | 90 | 2117 ms |
| 15:38 | exceededResources | 16 | **10.0** | 19 | 15 ms |
| 15:38 | success | 179 | 8.9 | 163 (max 246) | 2116 ms |
| 15:39 | exceededResources | 7 | **10.0** | 22.5 | 245 ms |
| 15:48 | exceededResources | 4 | **10.0** | 10 | 13 ms |

- Killed requests have a median of exactly **10.000 ms CPU**, often with
  13–15 ms wall time. They die in the first few milliseconds of real work.
  That matches the Free plan limit (10 ms). On Workers Paid the default is
  30 s, so a cutoff at 10 ms wouldn't happen.
- The zone plan is "Free Website". `limits` on the script is null. The
  account-events research doc (`docs/architecture/account-events/research.md`)
  already cites "free = 100k req/day, 10ms CPU/req".
- Before 2026-10-17 there were **no** `exceededResources` invocations in the
  retained window (≈ 2026-08-20 → 2026-10-16), even though daily CPU p99 was
  100–340 ms. Free-plan enforcement tolerates occasional overruns. Sustained
  overruns at higher volume trigger it.
- The script was last modified **2026-10-08** (release `b7d7e7d6`, the same
  release on the Sentry events), so this isn't a code regression.

### 2. Volume spike and the self-sustaining tail

Daily invocations: about 100–1,500/day normally. On 2026-10-17 there were
3,820 ok and **1,310 exceeded**. On 2026-10-18 there were 4,460 ok and
**830 exceeded**. From 2026-10-19 on, zero exceeded.

Hourly, the failures continued well after the 15:37–15:43 test:
10-17 16:00–23:00 had about 120–215 exceeded/hour. 10-18 12:00–19:00 had about
40–220 exceeded/hour.

Zone traffic per path (all from PT, i.e. the test machine's browsers):

| window | path | 200 | 503 |
|---|---|---|---|
| 10-17 15:30–15:50 | `getAccountEventsToken` (serverFn 67ea3a…) | 334 | 14 |
| | `getActiveJobs` (b5882e…) | 121 | 21 |
| | `getLikedSongsPage` (f9aa4d…) | 52 | 8 |
| | `getPreferredMatchReviewSummary` (9a3602…) | 44 | 6 |
| | `getSongSuggestions` (95fc0b…) | 11 | 4 |
| | `/liked-songs` (SSR) | 18 | 7 |
| | `/playlists/new` (SSR) | 3 | 5 |
| | `/match` (SSR) | 8 | 3 |
| | `/dashboard` (SSR) | 6 | 1 |
| 10-17 15:50–24:00 | `getAccountEventsToken` | **1,591** | **997** |
| | `getActiveJobs` | 213 | 175 |
| 10-18 12:00–20:00 | `getAccountEventsToken` | **984** | **836** |

- The endpoint that failed most often is the **SSE token mint**: a few
  hundred bytes, one HMAC, one rate-limit binding call. A light handler failing
  this way shows the limit is being hit by fixed per-request overhead, not by
  what the route itself does.
- Overnight 10-17→10-18 a client minted a token about every 16 s
  (≈229/h, paired 1:1 with `/rest/v1/account`, which is the auth middleware's
  account lookup). That cadence matches `useAccountEvents` stuck in its
  backoff loop at the 30 s cap (`random() * 30s` gives a mean of about 15 s).
  So the SSE connect never reached `connected`. The tokens succeeded but the
  gateway connection kept failing. `getActiveJobs` was absent overnight,
  consistent with React Query pausing `refetchInterval` in a hidden tab,
  while the `setTimeout` reconnect loop keeps running.
- In the steady state (10-18 00:00–11:00, 2,551 requests, almost all token
  mints), CPU was **p25 8.8 / p50 10.5 / p75 12.9 / p90 17 ms**. More than
  half of the cheapest authenticated requests are already over 10 ms.

### 3. Ray IDs from the error pages

All five map to 503 at the edge (zone `httpRequestsAdaptive`):

| ray | time (UTC) | path |
|---|---|---|
| a4c0620bb940f4f9 | 15:37:09 | /liked-songs |
| a4c064b139d3f55c | 15:38:58 | /liked-songs |
| a4c069604bfcff4e | 15:42:09 | /playlists/new |
| a4c069b11b7910fc | 15:42:22 | /liked-songs |
| a4c06aa4bb5bb2a2 | 15:43:01 | /liked-songs |

### 4. Payloads are small, so this is not the 790-song library

Average edge response sizes in the incident window: `/liked-songs` 13 KB,
`/dashboard` 9 KB, `/match` 12 KB, `/playlists/new` 27 KB, `/playlists` 31 KB,
`getLikedSongsPage` 5.4 KB. The loaders are bounded:

- `/liked-songs`: paginated infinite query, plus an optional deep-link
  bootstrap prefix.
- `/match`: a bounded deck read that seeds two cards.
- `/dashboard`: one `dashboardPageData` call.

No embedding/vector math runs in the Worker (that's the Bun worker), and
nothing dehydrates the full library. The "phone width mostly succeeded"
observation is most likely chance or timing relative to enforcement windows,
not a different code path. SSR does the same work at any width.

### 5. Sentry

Only client-side fallout in the window, all release `b7d7e7d6`, HeadlessChrome:

- `HEARTED-MUSIC-1P` (5 events, 15:36:58–15:42:48, `/liked-songs`),
  `-1N` (`/match`) and `-1Q` (`/match`):
  `TypeError: Cannot read properties of undefined (reading 'nextCursor')` in
  `src/features/liked-songs/queries.ts:91` `getNextPageParam`. When a page
  server-fn call hits a 1102 (503 HTML), an `undefined` page ends up in the
  infinite query's `pages`, and `getNextPageParam` crashes. This is a
  secondary robustness bug, not a cause.
- `HEARTED-MUSIC-1G` (hydration mismatch on `/match`) began 10-16, before the
  incident. Probably unrelated.
- There are no server-side events. 1102 terminates the isolate, so
  `withSentry` never captures. Sentry can't see this class of failure, so
  rely on CF analytics or alerts.

## Where the ~10 ms of per-request CPU goes (code analysis, not profiled)

All runs on every request, before any route logic:

1. **`Sentry.withSentry` (`src/server.ts`)**: the Cloudflare SDK calls
   `init()` (new client and integrations) on every request, and with
   `tracesSampleRate: 0.05` it also wraps each request in a span. It ends with
   `waitUntil(client.flush(2000))`
   (`node_modules/@sentry/cloudflare/build/esm/request.js:149`). That's why
   successful requests show **wall p50 ≈ 2,117 ms**. It's waitUntil time, not
   user latency, but it does keep isolates busy.
2. **`authRequestMiddleware` (`src/start.ts` →
   `auth-request-state.server.ts`)**: on the first request in an isolate it
   dynamically imports the **≈870 KB** `auth-request-state.server` chunk
   (better-auth + drizzle + postgres.js). That compile/eval cost is charged to
   the request. With smart placement and low traffic, isolates are often cold.
   Each request also builds a **fresh `betterAuth({...})` instance** (endpoint
   and plugin setup) inside `getAuth()`.
3. **`loadAuthSession` (`auth.server.ts`)**: verifies the signed cookie
   (cheap), then calls PostgREST for the account
   (`getAccountByBetterAuthUserId`). That's I/O, but JSON parsing and
   Supabase-JS overhead still count. Every 5 min the cookie cache expires
   and the request opens a new postgres.js TCP+TLS connection with SCRAM auth
   (PBKDF2), which is noticeably more CPU.
4. **TanStack Start**: the CSRF middleware, the server-fn resolver (a dynamic
   import per function chunk on a cold isolate), and seroval serialization.
   For SSR routes there's also React `renderToReadableStream` of the
   authenticated shell plus the route.

On a cold isolate, (2) alone can exceed 10 ms. On a warm one, (1)+(2)+(3)+(4)
lands around the measured 8–13 ms. That puts each request at or just over
the free limit.

Request sources that multiply this cost:

- `useAccountEvents` re-mints a token on every reconnect attempt, and
  `token_expiring` forces a re-mint every 5 min per tab.
- `getActiveJobs` polls every 15 s (5 s while a job runs) whenever SSE isn't
  `connected`. So an SSE outage or a 1102 on the token mint turns into more
  polling, more CPU, and more 1102s.
- PostHog proxy (`/api/pulse-h/*`, `/api/pulse-s`) and the Sentry tunnel run
  through the same Worker. In the test window that was about 550 proxy
  requests in 20 min, each using some CPU and adding to the overall load.

## Ranked root causes

1. **Workers Free plan 10 ms CPU limit vs. about 10 ms of fixed per-request
   overhead.** Very likely. Evidence: killed invocations sit at exactly
   10.0 ms CPU; 50%+ of the cheapest authenticated requests use more than
   10 ms; the failing endpoints include trivial server fns; free zone and
   `limits: null`; no deploy since 10-08. (The Workers subscription itself
   couldn't be read, because billing API access was denied.)
2. **Volume-triggered enforcement, amplified by client retry and polling.**
   Likely. The test raised volume about 10× and the failures began. The
   `useAccountEvents` token loop and the `getActiveJobs` fallback polling
   kept volume up (≈2,600 token mints in the 8 h after the test, about 45%
   of them 503) until the tabs closed on 10-18 around 19:00.
3. **Cold-isolate lazy chunk evaluation** (≈870 KB auth chunk plus
   per-server-fn chunks) charged to the request's CPU. Likely contributor;
   it explains kills with 13–15 ms wall time.
4. **Per-request `betterAuth()` construction and per-request Sentry
   `init()`.** Plausible contributor; not profiled.
5. **SSE gateway connection failing** (cadence evidence only). It's a
   multiplier, not a direct cause. Check gateway logs for 10-17/18.

Ruled out: large SSR or hydration payloads, N+1 for the 790-song library,
in-Worker embedding math, a memory limit (failures are CPU-shaped at 10 ms,
and payloads are tiny), and a code regression.

## Suggested fixes (in priority order)

1. **Move the account to Workers Paid ($5/mo) and set `limits.cpu_ms`**
   (e.g. `"limits": { "cpu_ms": 1000 }` in `wrangler.jsonc` as a runaway
   guard). This removes the 10 ms ceiling outright; current usage of about
   2–5k req/day × ~10 ms is far inside the included 30M CPU-ms. First confirm
   the plan in Dashboard → Workers & Pages → Plans.
2. **Stop the client amplification loop.**
   - In `useAccountEvents`, cache the minted token until shortly before
     `exp` and reuse it across reconnects instead of re-minting per attempt.
   - Pause reconnects while `document.hidden` and resume on
     `visibilitychange`.
   - Treat 5xx from the token mint as backoff-worthy with a higher floor.
   - Make `getActiveJobs` fallback polling back off on consecutive failures.
   - Separately, find out why the SSE gateway connect failed every attempt on
     10-17/18.
3. **Cut fixed per-request CPU.**
   - Construct `betterAuth()` once per isolate. It's safe to hoist if the
     per-request postgres client is injected lazily, or if the adapter only
     resolves `sql` on DB access.
   - Consider moving Sentry from `withSentry` per-request init to sampling
     only errors on the server, or check whether `instrumentPrototypeMethods`
     or integrations can be trimmed.
   - Keep the auth chunk small, or import it eagerly at top level so it's
     paid at isolate startup (which has its own 1 s budget) rather than on
     the first request.
   - Optionally serve the PostHog proxy via a Cloudflare route or Snippet
     rather than the app Worker.

Smaller follow-ups:

- Fix `getNextPageParam` in `src/features/liked-songs/queries.ts` (and the
  `/match` equivalent) so a failed page can't crash the infinite query
  (HEARTED-MUSIC-1P/1N/1Q).
- Add a CF notification or alert on `exceededResources`, because Sentry
  can't see 1102s.
- Give wrangler or a scoped API token the Workers Observability read
  permission, so per-request logs (path + CPU) can be queried next time.

## Reproduce the queries

The wrangler OAuth token is in `~/.config/.wrangler/config/default.toml`.
Account `9181203e8719e8064ea2692a0b8e1591`, zone `7e80ca7d41814d5a94b55daab2b5f11d`.
GraphQL datasets: `workersInvocationsAdaptive` (filter
`scriptName:"hearted-music"`, quantiles `cpuTimeP50/P99` in µs,
dimension `status`) and zone `httpRequestsAdaptiveGroups` /
`httpRequestsAdaptive` (filter `rayName_in`). Server-fn hash → name mapping
is in `dist/server/assets/__23tanstack-start-server-fn-resolver-*.js`.
