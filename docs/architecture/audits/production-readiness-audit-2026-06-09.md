# Production Readiness Audit — 2026-06-09

Full-codebase audit ahead of production release, covering security, reliability,
performance, correctness, ops readiness, and database/migrations. Six parallel
deep-dives across the app (`src/`), the Bun worker (`src/worker/`), the browser
extension (`extension/`), and all Supabase migrations. Every blocker-level
finding was re-verified directly in source before inclusion.

**Verdict: NO-GO until the blockers below are fixed — then GO.**
Two findings silently lose user data or paid fulfillment on core flows. Both are
small, localized fixes (the full blocker group is realistically 1–2 days of
work). The usual pre-launch killers — exposed secrets, missing RLS, IDOR,
injection, webhook spoofing, race-prone job claiming — all came back clean,
several with evidence of deliberate hardening.

Issues are numbered by overall priority (1 = most urgent) and grouped by
release impact.

**Progress (updated 2026-06-10):** Blockers **#1** (re-liked data loss,
`c0dae1b`) and **#2** (billing bridge swallowing fulfillment failures,
`164ca79`) — the two findings that silently lose user data or paid
fulfillment — are now fixed. Addendum brand-service fixes 1–4 plus the
lower-priority pass are done (including the `pack_credit_lot` checkout-session
correlation migration in this repo). Blocker **#3** (email verification now
required) is fixed. Blocker **#6** (`VITE_PUBLIC_APP_ORIGIN` in CI) is fixed.
Blocker **#4** (sync writes now chunked) is fixed — large-library staging run
still owed. Blocker **#5** (`.max()` bounds on validated inputs) is fixed.
All Group 1 blockers are fixed. Verdict flips to **GO** pending the full staging rehearsal.

---

## Group 1 — NO-GO: release blockers

Fix all of these before going live.

### 1. [x] Re-liked songs are permanently stuck as "unliked" (data loss)

> **Done** — `c0dae1b fix(spotify-sync): restore re-liked songs lost by soft-delete diff`

- **Area:** Reliability / Correctness
- **Where:** `src/lib/workflows/spotify-sync/sync-helpers.ts:172-178`,
  `src/lib/domains/library/liked-songs/queries.ts:66-77` (`getAll`),
  `src/lib/domains/library/liked-songs/queries.ts:553-574` (`upsert`)
- **Problem:** `incrementalSync` diffs incoming Spotify IDs against `getAll()`,
  which has no `unliked_at IS NULL` filter — soft-deleted rows are included. A
  song the user unliked and later re-liked is already in `dbSpotifyIds`, so it
  lands in neither `toAdd` nor `toRemove`: nothing runs. Even if the upsert did
  run, its payload is only `{account_id, song_id, liked_at}`, so
  `ON CONFLICT DO UPDATE` never clears `unliked_at`.
- **Impact:** Any unlike → re-like cycle silently and permanently loses the song
  from the user's library. Hits real users in week one; no error surfaced.
- **Fix:**
  1. In `incrementalSync`, detect incoming IDs whose DB row has `unliked_at`
     set and explicitly restore them
     (`UPDATE liked_song SET unliked_at = NULL, liked_at = $new WHERE account_id = $1 AND song_id = $2`).
  2. Add `unliked_at: null` to the upsert payload at `queries.ts:564` so the
     upsert path is self-healing.
  3. Add a regression test for like → sync → unlike → sync → re-like → sync.

### 2. [x] Billing bridge marks paid events "processed" even when fulfillment fails

> **Done** — `164ca79 fix(billing): propagate library-processing apply failures in bridge handlers`

- **Area:** Reliability / Billing
- **Where:** `src/lib/domains/billing/bridge-handlers.ts` (all five handlers:
  `handlePackFulfilled`, `handleUnlimitedActivated`, `handlePackReversed`,
  `handleUnlimitedPeriodReversed`, `handleSubscriptionDeactivated`);
  `src/routes/api/billing-bridge.ts:156-180`
- **Problem:** Every handler `console.error`s an `applyLibraryProcessingChange`
  failure and returns normally. The route then calls
  `mark_billing_bridge_event_processed`, so the upstream never retries.
- **Impact:** A transient DB error during fulfillment means a customer pays,
  the event is consumed forever, and the library-processing effects (queuing
  songs for enrichment) never happen — no retry path, only an unstructured log
  line. Reverse direction is worse: a failed _revocation_ means access is never
  revoked.
- **Fix:** Throw when `applyLibraryProcessingChange` fails so the route's catch
  block calls `mark_billing_bridge_event_failed` and the upstream retries. The
  idempotency claim (`claim_billing_bridge_event`) already makes retries safe.

### 3. [x] Email verification is not required for account access

> **Done** — `requireEmailVerification: true`. The signup branch in
> `login.tsx` no longer relies on `autoSignIn` (which is suppressed when
> verification is required); it switches to sign-in mode with a "check your
> inbox / spam" notice instead of navigating to `/dashboard` with no session.
> The sign-in path already humanized `EMAIL_NOT_VERIFIED`. Notice-rendering
> guards added to `LoginForm.test.tsx`.

- **Area:** Security
- **Where:** `src/lib/platform/auth/auth-request-state.server.ts:110` —
  `requireEmailVerification: false` with `autoSignIn: true`
- **Problem:** Anyone can sign up as `victim@example.com` and get a fully
  functional account under that email, including billing.
- **Impact:** Email squatting / identity mess; support burden when the real
  owner signs up later.
- **Fix:** Set `requireEmailVerification: true`. Infrastructure is already
  wired (`sendOnSignUp: true`, verification emails, `UnverifiedEmailBanner`).
  Not quite one-line: the signup flow assumed `autoSignIn` issued a session,
  so it needed the sign-in-mode + notice handoff above.

### 4. [x] Initial-sync upserts are not chunked

> **Done (2026-06-10)** — Shared `chunkedWrite` helper
> (`src/lib/shared/utils/chunked-write.ts`) now wraps every bulk sync write
> (catalog/liked-song/artist/playlist upserts, `markItemsNew`, and the `.in()`
> deletes). Real risk was silent `.select()` truncation at `max_rows=1000`, not
> request size: chunk 500 (upserts) / 100 (`.in()`), low concurrency. Tests +
> typecheck + biome clean. **Still owed:** the few-thousand-song staging sync.

- **Area:** Performance / Reliability
- **Where:** `src/lib/workflows/spotify-sync/sync-helpers.ts:48-50`
  (`upsertCatalog`), `src/lib/domains/library/liked-songs/queries.ts:553`
  (`upsert`)
- **Problem:** First sync sends the entire library (potentially 5–10k songs) in
  single PostgREST calls inside a Cloudflare Worker request. The read side
  (`getByIds`) already chunks at 100 with concurrency 4; the write side doesn't.
- **Impact:** Onboarding of the most enthusiastic users (largest libraries) is
  bet on Supabase's request-size ceiling. Failure mode is a broken first sync —
  the worst possible first impression.
- **Fix:** Reuse the existing `chunkArray + mapWithConcurrency` pattern for
  both upserts. Then test a real sync with a few-thousand-song library before
  launch.

### 5. [x] Unbounded arrays/strings in validated inputs

> **Done (2026-06-10)** — `.max()` bounds at all five sites: `songIds.max(10_000)`
> (client slices to a shared const — it accumulates across a session, so 200 would
> drop flushes), `playlistIds.max(500)`, handles `.max(100)`, playlist
> `name.max(500)` / `description.max(5000)` on both update **and** create schemas.
> typecheck + tests + biome clean.

- **Area:** Correctness / Abuse resistance
- **Where:**
  - `src/lib/server/matching.functions.ts:548` — `songIds: z.array(z.uuid())`, no `.max()`
  - `src/lib/server/matching.functions.ts:511` — `playlistIds`, same
  - `src/lib/server/account-handle.functions.ts:28` — unbounded handle string
  - `src/lib/server/public-handle.functions.ts:19` — unbounded handle string on
    an **unauthenticated** function hit on every `/@handle` load
  - `src/lib/server/playlists.functions.ts:255-261` — unbounded `name`/`description`
    written to the DB
- **Impact:** Cheap write/CPU amplification vectors; one bad actor away from a
  DB incident.
- **Fix:** Add `.max()` everywhere: `songIds.max(200)`, `playlistIds.max(100)`,
  handles `.max(100)`, playlist `name.max(500)` / `description.max(5000)`.
  ~30 minutes of work.

### 6. [x] `VITE_PUBLIC_APP_ORIGIN` may be missing from the CI build env (verify)

> **Done (2026-06-10)** — verified it was genuinely missing: the
> `production-app` GitHub environment had no such variable, and environment
> vars are never auto-injected into job env anyway. Created
> `VITE_PUBLIC_APP_ORIGIN=https://hearted.music` in the environment via
> `gh api` and added it explicitly to the deploy-app `env:` block.

- **Area:** Ops
- **Where:** `src/env.ts:61` (required `z.url()`);
  `.github/workflows/main.yml` deploy-app `env:` block does not set it
- **Problem:** Client-schema validation is skipped at build time
  (`isServer` is true), so a missing value does NOT fail the build — it crashes
  every page at runtime via `readRequiredUrlClientEnv`.
- **Impact:** Worst case is a full production outage from a green build.
- **Fix:** Confirm whether the `production-app` GitHub environment injects it;
  either way add it explicitly to the `env:` block so the dependency is
  visible. Two-minute check.

### 7. [x] `billing_admin_task.stripe_event_id` is not UNIQUE

> **Done (2026-06-10)** — added migration
> `20260610020000_billing_admin_task_stripe_event_id_unique.sql` with the
> UNIQUE constraint and applied it locally via `supabase migration up`.
> Follow-up **resolved** in the billing-service repo (`v1_hearted_brand`,
> `src/handlers/refund.ts` `createAdminTask`): bare `ON CONFLICT DO NOTHING`
> was insufficient. The handler also marked the event `failed`
> **unconditionally**, so every successfully-filed ambiguous dispute returned
> 500 and Stripe re-delivered the same event for its full ~3-day window —
> tripping Stripe's "endpoint is failing" warnings and risking auto-disable.
> Fix: insert via `upsert(..., { ignoreDuplicates: true })` (swallows the
> 23505, so a returned error means a genuine failure to file), then mark the
> event `processed` once the task is filed-or-already-exists (the task IS the
> resolution; stop retrying) and reserve `failed` for a real "couldn't file it"
> error that should retry.

- **Area:** Database / Billing
- **Where:** `supabase/migrations/20260406000000_billing_admin_task.sql`
- **Problem:** A re-delivered chargeback/reversal webhook creates duplicate
  operator tasks for the same Stripe event.
- **Impact:** Double-resolution or missed resolution of billing actions; ledger
  reconciliation errors.
- **Fix:**
  ```sql
  ALTER TABLE billing_admin_task
    ADD CONSTRAINT billing_admin_task_stripe_event_id_key UNIQUE (stripe_event_id);
  ```

### 8. [x] `oauth_account` lacks `UNIQUE(user_id, provider_id)`

> **Done (2026-06-10)** — migration
> `20260610132645_add_oauth_account_unique_user_provider.sql` adds the unique
> index and was applied locally.

- **Area:** Database / Auth
- **Where:** `supabase/migrations/20260303154135_add_better_auth_tables.sql:29`
- **Problem:** Concurrent first-time Google sign-ins for the same new user can
  insert duplicate rows; better-auth's single-row lookup does not handle
  multiple rows gracefully.
- **Impact:** Session creation failure; worst case a permanently locked-out user.
- **Fix:**
  ```sql
  CREATE UNIQUE INDEX oauth_account_user_id_provider_id_key
    ON oauth_account (user_id, provider_id);
  ```

### 9. [x] Test suite is not green (repo health gate)

> **Done (2026-06-10)** — `seedLikedSongs` rewritten to two bulk inserts (songs
> then liked_song rows); 1,002 sequential round-trips → 2. Failing test now runs
> in 132 ms. Suite: 16/16 passed. `typecheck` and `biome check` clean.

- **Area:** Repo health (carried over from `mvp-release-findings.md`, re-verified 2026-06-09)
- **Where:** `src/lib/domains/billing/__tests__/liked-song-access-grant.integration.test.ts:265`
  — "caps the snapshot at the current top 500 liked songs" times out at 15s.
- **Problem:** `seedLikedSongs` performed 1,002 sequential awaited inserts
  (501 × `seedSong` + `likeSong`) — a test-harness performance issue, not a
  production defect.
- **Fix:** Bulk-insert songs and liked_song rows in two statements.

---

## Group 2 — GO: fix in the first days after launch

Not blocking, but each has real production impact. Ordered by priority.

### 10. [x] Worker drain timeout (30s) is shorter than a job

- **Area:** Ops
- **Where:** `src/worker/config.ts:24` (`WORKER_DRAIN_TIMEOUT_MS` default
  30,000), `src/worker/index.ts:54-65`; missing `Sentry.flush` before graceful
  exit at `src/worker/index.ts:77`
- **Problem:** Enrichment jobs (embeddings + LLM analysis) can run for minutes.
  Every deploy mid-job exits with jobs stuck in `processing` until the 5-minute
  stale sweep.
- **Impact:** Every release window degrades the queue for affected accounts.
- **Fix:** Raise drain timeout to ≥ the longest expected job (5–10 min); set
  the Coolify container stop grace period above it. Add
  `await Sentry.flush(2000)` before `process.exit(0)`.
- **Shipped:** `WORKER_DRAIN_TIMEOUT_MS` default raised to 600,000
  (`config.ts`); `await Sentry.flush(2000)` added before graceful exit
  (`index.ts`). Ops follow-up: set Coolify stop grace period above the drain
  timeout (code change is inert until then).

### 11. [x] Full-library reads on hot paths

> **Done (2026-06-10)** — Column-narrowing, no schema change. `getMatchResults`
> now selects `song_id, playlist_id, score` (drops the per-row `factors` JSONB —
> the bulk of the transfer); the per-song detail path uses a new bounded
> `getMatchResultDetailsForSong` so factors load only for the displayed song.
> `getAll` (sync diff + analysis sweep) selects `song_id, unliked_at` only,
> keeping soft-deleted rows so the re-like diff (#1) stays correct. The suggested
> `(snapshot_id, song_id)` index was already covered by the unique constraint /
> `idx_n_snapshot_rank` prefixes; the RPC rewrite was deferred (residual cost is a
> cheap 3-column in-memory pass once the JSONB is gone). typecheck + tests clean.

- **Area:** Performance
- **Where:** `src/routes/api/extension/sync.tsx:430` → `getAll` (no LIMIT, no
  `unliked_at` filter); `src/lib/domains/taste/song-matching/queries.ts:58-70`
  via `src/lib/server/matching.functions.ts:114` (all `match_result` rows per
  snapshot, undecided derivation in the Worker)
- **Impact:** At 5k songs × 3 playlists, tens of thousands of rows materialized
  per `/match` load / sync, on a CPU-limited runtime. Degrades linearly with
  the most valuable users.
- **Fix:** Sync: fetch only active rows or diff DB-side (also shrinks the blast
  radius of issue #1). Matching: push `deriveUndecidedSongs` into an RPC
  returning ordered undecided IDs only; use the bounded
  `getMatchResultsForSong` for the per-song path. Add
  `CREATE INDEX ON match_result(snapshot_id, song_id);`

### 12. [x] `prod-secrets.json` survives on disk if the deploy fails

> **Done (2026-06-10)** — Resolved by decision, not by the originally-proposed
> pipe. Dropped `&& rm prod-secrets.json` from `deploy:secrets` and now keep the
> file on disk intentionally (gitignored at `.gitignore:12`, so it never enters
> the repo) so secrets can be re-pushed without regenerating. This **accepts**
> the plaintext-secrets-on-local-disk exposure rather than eliminating it — the
> "survives a failed deploy" race is moot once the file is never deleted.
> Residual risk is bounded to the operator's local machine.

- **Area:** Ops / Security
- **Where:** `package.json:40` — now `... && wrangler secret bulk < prod-secrets.json`
  (no trailing `rm`)
- **Problem:** The `rm` never runs if wrangler fails, leaving a plaintext file
  with every production secret in the project directory.
- **Resolution:** Pipe-direct was rejected in favor of keeping the gitignored
  file for re-push convenience; the exposure is accepted as local-only.

### 13. [x] Concurrent extension syncs for one account aren't atomically gated

> **Done (2026-06-10)** — Migration
> `20260610140000_add_unique_active_sync_constraint.sql` adds the partial unique
> index (one active `sync_liked_songs` per account). The sync route now acquires
> that sentinel first and alone; a losing race surfaces as a `ConstraintError`
> mapped to the existing 429 (no sibling jobs created, winner's lock not failed).
> Tests + typecheck clean; index enforcement verified live against the local DB.

- **Area:** Reliability
- **Where:** `src/routes/api/extension/sync.tsx:205-243` — plain SELECT gate
  (`getActiveSync`), no DB-level guard (unlike enrichment, see migration
  `20260315050003`)
- **Impact:** Two simultaneous syncs both pass the gate, create 6 jobs, and
  double-fire `applyLibraryProcessingChange` — duplicate enrichment work and
  queue inflation (upserts keep data correct).
- **Fix:**
  ```sql
  CREATE UNIQUE INDEX ON job (account_id)
    WHERE type = 'sync_liked_songs' AND status IN ('pending', 'running');
  ```
  Treat 23505 as "sync already running".

### 14. [x] One unexpected throw in the sweep tick kills the whole worker

> **Done (2026-06-10)** — Fixed deeper than the original one-line `.catch()`.
> Each of the five sweep steps now runs inside a `runStep` wrapper (log
> `sweep-step-threw` + `Sentry.captureException`), making `runSweepTick` total —
> it can no longer reject, and one failing step no longer aborts the others.
> `startSweep` also switched from `setInterval` to a self-scheduling `setTimeout`
> loop that queues the next tick only after the current one settles, closing the
> overlap window where a slow tick could double-process the same rows (the
> non-atomic terminal-ref path). New tests cover step isolation and no-overlap;
> suite + typecheck clean.

- **Area:** Reliability
- **Where:** `src/worker/sweep.ts:148` — `setInterval(() => runSweepTick(deps), intervalMs)`
  with no `.catch()`; rejections hit the fatal handler → `process.exit(1)`
- **Impact:** A single sweep error restarts the container and drops in-flight
  jobs (recoverable via startup sweep, but with a processing gap each time).
- **Fix:** `.catch()` inside the interval callback: log +
  `Sentry.captureException`, don't die.

### 15. [ ] PostHog tunnel has no rate limiting

- **Area:** Security / Cost
- **Where:** `src/routes/api/posthog/$.ts:116-123` (host allowlisting is solid;
  no SSRF)
- **Impact:** Unauthenticated traffic can pump unlimited events through the
  tunnel into the PostHog quota.
- **Fix:** Apply the same `withinRateLimit` pattern as the Sentry tunnel; add a
  namespace in `wrangler.jsonc`.

### 16. [x] Per-request TCP connection for every auth check

> **Done (2026-06-10)** — Enabled better-auth `session.cookieCache` (5 min). The
> per-request socket is forced by Workers and `postgres.js` connects lazily, so a
> cookie-cache hit opens no socket — the handshake leaves the hot path. Tradeoff:
> revocations lag ≤ maxAge. Hyperdrive deferred to a separate infra ticket (needs
> direct connection + `prepare: true` + caching off); no longer urgent for auth.

- **Area:** Performance
- **Where:** `src/lib/platform/auth/auth-request-state.server.ts:43-48` — new
  `postgres(env.DATABASE_URL, { max: 1 })` per request
- **Problem:** Works on Workers (`nodejs_compat` TCP + `prepare: false` is
  correctly configured), but every authenticated request pays a fresh TCP+TLS
  handshake to the pooler before better-auth can read the session.
- **Impact:** Tens of ms of latency tax on every authenticated page.
- **Fix:** Put Cloudflare Hyperdrive in front of `DATABASE_URL` (config-only),
  or move better-auth onto the existing Supabase HTTP client via a custom
  adapter.

---

## Group 3 — GO: scheduled hardening (post-launch backlog)

### Security

17. [x] **Live Spotify `sp_dc` session cookie on disk** —
        `.playwright/spotify-auth.json:95`, `.playwright/debug-state.json`
        (gitignored but real, valid until 2027). Delete both, rotate the Spotify
        session, consider a gitleaks pre-commit hook.
18. [ ] **Supabase local demo service-role JWT hardcoded in tracked scripts** —
        `scripts/matching-lab/diagnose-embeddings.ts:5`,
        `backfill-playlist-songs.ts:22`, `server.ts:40`, `reprofile-playlists.ts:20`.
        Read from `SUPABASE_SERVICE_ROLE_KEY` env instead.
        **Backlog (2026-06-10) — false alarm, not a prod risk.** Re-verified in
        `scripts/matching-lab/shared.ts:12-15`: this is the well-known
        `supabase-demo` *public default* service-role key that ships with
        `supabase start`, hardcoded only in local-lab scripts pinned to
        `127.0.0.1:54321`. It is not a production secret and never touches prod.
        Env-ifying it is cosmetic hygiene; deferred to backlog.
19. [x] **Extension CORS reflects `Access-Control-Request-Headers`** —
        `src/lib/server/extension-cors.ts`. **Done (2026-06-10)** — `Allow-Headers`
        now hardcoded to `"Authorization, Content-Type"` (the only headers the
        extension client sends); dropped the reflected read and the matching
        `Vary` entry.
20. [ ] **Sync body-size guard is a no-op without a Content-Length header** —
        `src/routes/api/extension/sync.tsx:271-280`: `Number(null)` is `0`, which
        passes; chunked bodies are fully buffered. Authenticated-only and CF caps
        bodies at ~100MB, so abuse-resistance only. Treat a missing header as
        suspect or check byte length after reading.
        **Backlog (2026-06-10).** Re-confirmed at `sync.tsx:271`. Authenticated-only
        + the CF ~100MB ceiling means this is abuse-resistance, not a hole — not
        launch-blocking. Deferred to backlog.

### Performance

21. [x] **Slug deep-links walk the library page-by-page** —
        `src/lib/domains/library/liked-songs/queries.ts:252-284, 401-459`. O(n/100)
        round-trips for old songs. Add a slug column or cursor-returning RPC
        (already noted as "Phase 2" in code). **Done (2026-06-10)** — migration
        `20260610160200_liked_songs_slug_resolution.sql`: indexed `song_slug()`
        expression (mirrors `generateSongSlug`) + a `liked_song_decorated` view
        backing the rewritten `get_liked_songs_page` and two new RPCs
        (`get_liked_song_by_slug`, `get_liked_songs_bootstrap_by_slug`). Both slug
        paths now resolve in one indexed query; the view also replaces the
        per-page whole-library entitlement scan. Tests + typecheck + biome clean.
22. [x] **`getPending` two-phase scan + missing composite index** —
        `queries.ts:488-546`. **Done (2026-06-10)** — premise was stale on both
        counts: the `(account_id, item_type, item_id)` index already exists (it
        backs the table's `UNIQUE` constraint), and the single anti-join already
        lives in the used path, `get_liked_songs_page(p_filter => 'pending')`
        (`LEFT JOIN account_item_newness ... WHERE ain.id IS NULL`). `getPending`
        itself had zero callers, so it was deleted (plus its now-orphaned
        `mapWithConcurrency` import) rather than optimized. No migration.
23. [ ] **GSAP + framer-motion in the initial bundle** —
        `src/features/landing/components/useHeroAnimation.ts:18` etc.; ~100KB gzip
        on every page for landing/onboarding-only libraries. Route-level code
        splitting. **Backlog (2026-06-10)** — perf polish, post-launch.

### Correctness

24. [x] **Stale credit balance returned after unlock** —
        `src/lib/domains/billing/unlocks.ts:137`. **Done (2026-06-10)** —
        `unlock_songs_for_account` now returns the authoritative `credit_balance`
        (migration `20260610150000`); orchestration uses it instead of the
        pre-RPC snapshot. Regression test added.

### Ops

25. [x] **Shared library code logs unstructured while the worker logs JSON** —
        `src/lib/workflows/library-processing/runner.ts`,
        `src/lib/workflows/enrichment-pipeline/orchestrator.ts`,
        `src/lib/server/billing.functions.ts`, etc.: bare `console.*` without
        `jobId`/`accountId`, interleaved with structured worker JSON. First
        stuck-job incident gets debugged by eyeball. Inject the worker logger into
        the shared layer. Note: CF Workers Logs retention is ~3 days — pairs with
        issue #2 (failures must land in the DB, not only logs).
        **Done (2026-06-10)** — worker logger promoted to a shared module
        (`src/lib/observability/logger.ts`); worker-only `console.*` in `runner.ts`,
        `orchestrator.ts`, and `lifecycle.ts` converted to structured `log.*` with
        `jobId`/`accountId`. The DB-persistence half of the note was already
        satisfied (`markJobFailed` writes `job.error`; per-item failures land in
        `job_item_failure`) — the one gap, settlement failures that occur _after_
        the job is marked completed (no DB trace), now also `captureException` to
        Sentry. `billing.functions.ts` is request-handler code, not worker; its
        server-side logging is deferred to a separate pass.
26. [x] **No staging target** — `wrangler.jsonc` has a single production route;
        every deploy goes straight to `hearted.music`. Add an `env.staging` worker
        even without a custom domain.
        **Won't do (2026-06-10) — accepted by decision.** Solo dev, small surface;
        the cost of maintaining a staging worker isn't justified. Deploys go
        straight to prod intentionally. The "staging rehearsal" is replaced by a
        controlled first-run prod smoke test (see Go / No-Go) — the only part that
        materially mattered was exercising the unproven large-library sync once
        before real users hit it, which can be done in prod with the owner's own
        account before any onboarding.
27. [x] **Worker health server binds 127.0.0.1** — `src/worker/health.ts:16`. Works
        for the in-container Docker HEALTHCHECK, brittle for any external Coolify
        health URL. Bind `0.0.0.0`. **Done (2026-06-10)** — now binds `0.0.0.0`;
        the in-container HEALTHCHECK still hits `127.0.0.1`, which a wildcard bind
        accepts.
28. [x] **Worker PostHog OTEL reads `VITE_`-prefixed vars at runtime** —
        `src/worker/posthog-otel.ts:6-7`. If unset on the container, LLM cost
        tracking silently disables. Rename to non-VITE names for the worker and
        document as required container env. **Done (2026-06-10)** — the worker now
        reads plain `POSTHOG_PROJECT_TOKEN` / `POSTHOG_HOST` (matching its other
        `process.env` config), falling back to the legacy `VITE_PUBLIC_*` names so
        an already-configured container doesn't regress. Documented as a required
        Coolify worker container env in `.env.example`. typecheck + biome clean.
        **Ops follow-up:** set `POSTHOG_PROJECT_TOKEN` (+ `POSTHOG_HOST`) on the
        Coolify worker container, or LLM cost tracking stays dark.

### Database

29. [x] **`account` + `account_billing` created non-atomically** —
        `src/lib/domains/library/accounts/queries.ts:122`. **Done (2026-06-10)** —
        new `create_account_with_billing` RPC (migration
        `20260610160000_create_account_with_billing_rpc.sql`) inserts both rows in
        one transaction and returns the account row; `createAccountForBetterAuthUser`
        calls it instead of two sequential inserts. `unlimited_access_source` is an
        RPC arg because the `self_hosted` decision is app-side (`BILLING_ENABLED`),
        which a plain trigger can't see — so self-hosted unlimited access is no
        longer lost on a mid-call failure. Tests + typecheck clean.
30. [x] **`match_result.score` is `REAL` while inserts cast to double** —
        `supabase/migrations/20260117000009_create_match_result.sql:8`. **Done
        (2026-06-10)** — migration
        `20260610160100_match_result_score_double_precision.sql` widens `score` and
        `fused_score` to `DOUBLE PRECISION`, so the existing `::DOUBLE PRECISION`
        insert casts are no longer silently narrowed back to single precision on
        write. Added a `playlist_id` tiebreaker to the three score-ordered reads in
        `taste/song-matching/queries.ts` (the two per-song reads had none), making
        ordering deterministic on ties.
31. [x] **No normalized-email index on `account` for the waitlist-grant join** —
        `supabase/migrations/20260601154816_create_waitlist_grant_eligibility_fn.sql:20`.
        **Not applicable (2026-06-10)** — the proposed `account` index would never
        be used: the function pins `account` by primary key to a single row, and the
        join's expensive side (`waitlist`) is already covered by the
        `waitlist_email_normalized_key` functional unique index from
        `20260601154230`. No change.
32. [ ] **`llm_usage` lacks a `(function_id, created_at)` index** —
        `supabase/migrations/20260609003846_create_llm_usage.sql`; one row per LLM
        call, grows fast. **Deferred (2026-06-10)** — `llm_usage` is insert-only in
        code today (nothing reads it by `function_id`), so the index would add write
        overhead to a hot table with no current consumer. Add it alongside the first
        analytics query that needs it.
        `CREATE INDEX llm_usage_function_created_idx ON llm_usage (function_id, created_at DESC);`

---

## Cross-check: `mvp-release-findings.md`

Reconciliation against the earlier release-findings doc, re-verified on
2026-06-09.

### Still relevant — carried into this audit

- **Test suite not green** → promoted to blocker **#9** above (1 failing test;
  typecheck and lint claims in the old doc are now stale — both pass).
- **Full staging rehearsal before launch** — still the single highest-value
  validation step and nothing in this audit replaces it: auth → onboarding →
  extension connect → sync (including the few-thousand-song library run from
  blocker #4) → worker processing → matching → Spotify write-back, against the
  production-shaped environment.
- **Free-first launch option** (billing disabled at launch, paid flipped on
  after the billing path is staging-proven) — still a valid risk mitigation
  that shrinks the blast radius of blocker #2. Note it does not replace fixing
  #2: the bridge also handles _revocations_, which must work whenever billing
  is eventually enabled.
- **UI/UX priorities** (onboarding/extension flow copy and retry states,
  signed-in navigation targets, empty/loading states, responsive pass,
  accessibility) — remain valid as launch polish, intentionally out of scope
  for this audit. See `mvp-release-findings.md` §UI/UX priorities.

### Resolved since that doc was written (stale claims — do not re-litigate)

- **"No normal CI pipeline"** — `.github/workflows/main.yml` now exists;
  both deploys are gated on `migrate-prod`.
- **"No error monitoring / telemetry"** — Sentry is initialized in all three
  runtimes (CF Workers server, browser, Bun worker) plus PostHog; the Sentry
  tunnel is rate-limited and DSN-validated.
- **Worker healthcheck port mismatch (3001 vs 3002)** — fixed:
  `Dockerfile.worker:10` sets `ENV WORKER_HEALTH_PORT=3002`, the HEALTHCHECK
  reads that env with a 3002 fallback, and `src/worker/config.ts:25` defaults
  to 3002.
- **"typecheck fails"** — `bun run typecheck` passes clean.
- **"many lint/a11y issues"** — `bun run check` reports 3 warnings / 3 infos.
- **Billing bridge hardening** — the old doc already corrected that transport
  hardening exists (HMAC, freshness window, idempotency); this audit confirms
  it, and found the remaining gap one layer deeper (blocker #2: handlers
  swallow fulfillment failures after the verified event is claimed).

---

## Verified clean

Areas explicitly audited and found sound (with deliberate hardening evident):

- **RLS / database surface:** every table has RLS with deny-all policies +
  revoked grants; the anon key is never used client-side, so the PostgREST
  surface is effectively closed. All SECURITY DEFINER functions pin
  `search_path`.
- **No exploitable IDOR:** playlist/song/snapshot ownership verified against
  the session account on all traced paths.
- **No SQL injection / XSS:** Supabase client + Drizzle only, no string-built
  SQL; lyrics rendered as plain text via htmlparser2 text-node extraction.
- **Env hygiene:** server env never leaks to the client (`@t3-oss/env-core`
  split with `isServer`); validation fails fast at boot.
- **Billing bridge transport:** HMAC-SHA256 with timing-safe compare, 5-minute
  window, idempotency via `claim_billing_bridge_event` lease RPC.
- **Job system:** claims use `FOR UPDATE SKIP LOCKED` in a single UPDATE;
  heartbeat 30s vs 5-min stale threshold; startup sweep recovers stranded jobs.
- **Handle identity (this branch):** same charset regex in app validation, DB
  CHECK, and lookup; lowercase normalization consistent; `claim_handle` RPC
  takes `FOR UPDATE` locks; 23505 mapped to "taken"; case-insensitive
  uniqueness enforced via partial unique index.
- **External calls:** all LLM/Last.fm/DeepInfra/Reccobeats fetches use
  `AbortSignal.timeout`; LLM output parsed via `generateObject` + Zod (no raw
  `JSON.parse` of model text).
- **Schema quality:** timestamptz everywhere, identity columns,
  `gen_random_uuid`/`uuidv7`, integer cents for money, HNSW vector indexes with
  cosine ops, all app-critical unique constraints present; pagination
  tied-cursor bug already fixed in `20260609042937`.
- **Deploy/CI:** both deploys gated on `migrate-prod`; Dockerfile exec-form CMD,
  non-root user, healthcheck; SIGTERM drain wired; Sentry initialized in all
  three runtimes with a rate-limited, DSN-validated tunnel; sourcemap upload
  fails fast without `SENTRY_AUTH_TOKEN`; daily pg_dump backups with runbook.

---

## Go / No-Go

**GO** as of 2026-06-10. All Group 1 blockers (1–9) are fixed. The flaws found
were localized logic bugs, not architectural ones; everything that is usually
fatal in a pre-launch audit came back clean.

**Staging dropped by decision (2026-06-10, see #26):** solo dev, small surface
— no staging worker, deploys go straight to prod. The full staging rehearsal is
replaced by a **controlled first-run prod smoke test**: after deploy and before
pointing any real users at it, run the full flow (auth → onboarding → extension
connect → sync → worker → matching → Spotify write-back) with the owner's own
account, and crucially with a **few-thousand-song library** to exercise the
unproven chunked-sync fix from blocker #4. That single large-library run is the
one piece of the old rehearsal that materially mattered.

---

## Addendum — Brand billing service (`v1_hearted_brand`), 2026-06-10

Follow-up review of the sibling Stripe billing service (Bun + Hono) and its
bridge into this app. The cross-repo bridge contract (endpoints, HMAC auth,
schema-v2 payloads, retry semantics) was verified to match exactly on both
sides. Tests (62) and typecheck pass after the changes below.

### Fixed in this pass

Code-level correctness bugs, resolved in `v1_hearted_brand` (plus one migration
in this repo):

1. [x] **Refund attributed to the wrong customer (subscription path).**
       `src/handlers/refund.ts` fallback listed the 10 most-recent invoices
       account-wide and took the first subscription match, so a subscription
       refund/chargeback could resolve to a _different_ customer's subscription.
       Now resolved through `stripe.invoicePayments.list({ payment: { payment_intent } })`
       — the invoice payment tied to _this_ charge. (`Charge.invoice` no longer
       exists in Stripe API 18.5.0, so the payment_intent → invoice-payment → invoice
       path is used.) The session-matched subscription branch had a milder cousin of
       the same bug — it read `billing_reason` from the subscription's _latest_
       invoice, so refunding an initial charge after a renewal would see
       `subscription_cycle` and skip the upgrade-conversion reversal; both branches
       now resolve the invoice through the refunded charge's own payment_intent
       (shared `findInvoiceForPaymentIntent` helper).
2. [x] **Pack refund reversed the wrong lot.** `reverse_pack_entitlement` was
       handed the account's most-recently-created `pack_credit_lot`
       (`ORDER BY created_at DESC LIMIT 1`), so refunding an older pack on a
       multi-pack account reversed the newest lot. Added a `checkout_session_id`
       correlation key: migration
       `supabase/migrations/20260610010000_pack_credit_lot_checkout_session_correlation.sql`
       (new column + partial unique index + `fulfill_pack_purchase` 6-arg signature
       storing it; EXECUTE re-granted to `service_role`), fulfillment passes
       `session.id`, and the refund path matches on it. A miss now files an admin
       task instead of guessing; a DB error throws so the webhook retries (no
       duplicate admin task).
3. [x] **`checkout.session.completed` with an unhandled `mode` looped forever.**
       `src/handlers/checkout-completed.ts` handled only `payment`/`subscription`;
       a `setup`-mode session fell through without `markWebhookEvent`, leaving the
       row `processing` → route 500 → infinite Stripe retry. Now acknowledged as a
       logged no-op.
4. [x] **Swallowed Supabase errors.** `markWebhookEvent`
       (`src/lib/webhook-event.ts`) now throws instead of only `console.error`-ing a
       failed status write (and the webhook route's catch is hardened so a throw
       during failure-marking still returns a clean 500). The discarded `error` on
       the `maybeSingle` lookups in `expiry.ts` and `refund.ts` is now checked.

Lower-priority items fixed in the same pass:

- **Coupon leak on retry.** `src/routes/checkout.ts` `stripe.coupons.create`
  now passes `idempotencyKey: coupon_<conversionId>`, so a client retry reuses
  the coupon instead of leaking a fresh dangling one.
- **Silent no-op update.** `handleSubscriptionCheckout`'s
  `account_billing` update now `.select()`s and fails the event if zero rows
  matched (missing-row guard) rather than acknowledging a no-op.
- **Renewals correctly send no bridge event (verified, no change).** The app
  reads subscription status/period-end directly from the shared `account_billing`
  table (`readBillingState`), which `handleRenewal` keeps current via
  `update_subscription_state`; `subscription_period_end` is never compared to
  `now()` to gate access. The bridge only drives library-processing
  reconciliation, which a renewal doesn't trigger — so the absence of a renewal
  bridge event is by design.
- **`Retry-After` on the app's 503 is advisory (documented, no change).** The
  sender's fixed backoff doesn't honor it; sustained limits are covered by
  Stripe's multi-day retry cycle. Noted in `src/lib/bridge.ts`.

### Deferred — deployment gaps (NOT addressed; tracked here)

These were intentionally left alone per scope. None are code-correctness bugs;
all are ops/packaging hardening for the brand service.

#### B1. [x] Dockerfile pins a different Bun than the lockfile

- **Where:** `v1_hearted_brand/Dockerfile:1` (`FROM oven/bun:1.2-alpine`) vs
  `package.json` (`"packageManager": "bun@1.3.14"`); `bun.lock` generated by
  1.3.14.
- **Impact:** `bun install --frozen-lockfile` runs under a different
  minor inside the image; `1.2` is also a floating tag.
- **Fix:** pin `oven/bun:1.3.14-alpine` (ideally by digest).
- **Done (2026-06-10):** pinned to `oven/bun:1.3.14-alpine` — the current latest
  stable (verified: `1`/`1.3`/`1.3.14` all share one digest; only `canary` is
  newer), and an exact match for the lockfile's generator. Resolves both the
  minor mismatch and the floating-tag drift. Digest pin deferred as cosmetic for
  a solo dev — the version tag is no longer floating, which was the real risk.

#### B2. [x] No graceful shutdown

> **Done (2026-06-10)** — `src/index.ts` now installs SIGTERM/SIGINT handlers
> that `await server.stop()` (Bun drains in-flight requests, refuses new ones),
> then `Sentry.flush(2000)` and `process.exit(0)`, guarded by a `draining` flag
> against double-fire — matching the worker's shutdown convention. The webhook
> handlers are sub-second DB writes, so they finish well inside Docker's default
> ~10s stop grace; the existing claim-lease + Stripe-retry path still backstops
> the rare handler that outlives the grace period, so the container stop grace
> was deliberately **not** widened (it just slows every deploy). The worker
> (`src/worker/index.ts`) already had full graceful shutdown — this closes the
> last gap, which was brand-only. Health-flip-to-draining and grace-period
> widening were considered and declined as not worth it pre-prod.

#### B3. [ ] No Dockerfile `HEALTHCHECK`

- **Where:** `v1_hearted_brand/Dockerfile` (none). `coolify.json` polls `/health`
  externally, but Docker-level health gating for the restart policy is absent.
- **Fix:** `HEALTHCHECK ... CMD wget -qO- http://localhost:3100/health || exit 1`.

#### B4. [ ] Self-declared Phase 7 launch gates unmet

- **Where:** `v1_hearted_brand/docs/MONETIZATION.md:198-204` — "Phase 7 launch
  hardening — not built": no billing E2E suites (free / pack / unlimited /
  refund / chargeback), no idempotency/concurrency suite, no runbook.
- **Fix:** build the E2E + concurrency suites and a launch runbook before
  enabling paid flows.

#### Backlog (warnings, non-blocking)

- No rate limiting on the brand's `/api/checkout/*` and `/api/portal/session`
  (the Stripe webhook is signature-protected; bridge is HMAC-gated).
- No per-request access log (only per-handler error logs + Sentry on 5xx).
- `instrument.ts` reads `SENTRY_DSN` from `process.env` before `loadEnv()`
  validation, so a malformed DSN initializes Sentry before the validating
  `process.exit(1)` fires.
