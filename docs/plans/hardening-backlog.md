# Hardening backlog

Open correctness, security, CI and structural work that is not part of the reliability push
(`docs/plans/reliability.md`). Re-checked against `main` on 2026-10-27; everything already fixed was
dropped. Sources, readable from git: `git show 062761c8:docs/tmp/infra-audit.md` (2026-08-16 audit,
ids T/A/N below), `…:docs/tmp/posthog-error-triage.md`, `…:docs/tmp/sentry-triage-2026-07-19.md`.

Effort: **S** < ½ day · **M** 1–2 days · **L** 3–5 days.

---

## 1. Security and data

### 1.1 Production account snapshot is committed to a public repo (T1) — accepted, no action

- `supabase/seeds/prod-snapshot.sql` (28 MB, added in `7ea6a708`) is tracked in a **public** GitHub repo
  and loaded on every local reset (`supabase/config.toml:63`). It holds the owner's own prod account:
  email, Better Auth user id, 764 liked songs, 126 playlists, unlocks and preferences. The
  `oauth_account` row has no tokens (access, refresh and id tokens are `NULL`).
- **Decision (2026-10-28).** Accepted as is: the data is the owner's and already public. Revisit only if
  another account's data would land in the seed.

### 1.2 Backups share the production VPS (T10) — L

- Backups live on the same box as the DB (`docs/ops/prod-db-backups.md:71-74`: "Offsite replication is
  the next upgrade").
- **Change.** Encrypted offsite copies, plus a restore drill on a schedule.

### 1.3 Postgres pooler is published on the internet — M

- `pooler-proxy` on the VPS listens on `0.0.0.0:5432`, protected by TLS and the Supavisor password. It
  was opened for the Cloudflare Worker, which had no stable egress range; the app now runs on the same
  VPS. CI already migrates over Tailscale (`docs/ops/prod-db-migrations.md`); the remaining public
  client is local `bun run prod:sql` (`scripts/db/prod.ts`, `PROD_DATABASE_URL`).
- **Change.** Point `prod:sql` at the Tailscale address, then stop publishing 5432. Replaces the
  Worker-era Hyperdrive plan (`git show c513d508:docs/plans/hyperdrive-private-database.md`).

---

## 2. Data integrity in the worker

Evaluated 2026-10-28. 2.4 (scheduling reads turning errors into false facts) is fixed: a failed read
now returns `{ kind: "load_facts"; cause: DbError }` from `applyLibraryProcessingChange`, which the
worker's settlement retries; 2.1 consumes it. 2.3 (partial target-playlist set) is fixed too. Only 2.1
remains.
Retry machinery today: enrichment and match-refresh jobs requeue on a throw while `attempts < 3`, with
30 s × attempt backoff (`library-processing-runner.ts:179-232`, `finalize.ts:37-58`). Extension sync has
no retry beyond the stale-job sweep: any returned error fails it on attempt 1 and deletes the payload.

### 2.1 Extension sync drops failed playlist-track writes and burns retries (T4 + A1) — M

- A failed playlist read becomes an empty map, so every playlist's tracks are skipped and the phase
  reports success (`src/worker/extension-sync-runner.ts:392-395`); a missing mapping or failed write
  becomes `null` (`:401-410`). Those playlists keep stale tracks and trigger no match refresh until the
  user syncs again by hand. Separately, a transient DB error fails the job and deletes the payload
  (`:180-188`), so the user has to re-scrape Spotify.
- **Change.** Phase 3 returns `Err` on any read or write failure; a missing mapping is deterministic, so
  it gets a Sentry warning instead. On a `DatabaseError` (`lifecycle.ts:26-28`), requeue the parent job
  compare-and-set (like `requeueLibraryProcessingJobForRetry`), keep the payload, and leave the phase
  `running` so resume takes it over (`sync-helpers.ts:297-372`). Migration: the extension-sync claim
  honours `available_at`. Re-running is safe (idempotent diff writes).
- **Test.** A failed playlist-track write fails the sync and keeps the payload instead of completing
  without that playlist (`extension-sync-runner.test.ts`; the case at `:388` changes behaviour).

### 2.5 Unverified: crash between state write and job creation (T3 note) — S

- `idle-recovery.ts` recovers enrichment when the process dies after the state write but before the job
  exists. Check whether a match refresh can be stranded the same way; add a recovery path if so.

---

## 3. Server-fn correctness

### 3.4 Match-refresh refs mutated during render (A9) — M

- `src/routes/_authenticated/match.tsx:236-244`. **Change.** Move the edge detection into an effect or
  derive it from query state.

---

## 4. CI and deploys

### 4.1 Destructive migrations are not gated (T9) — M

- `.github/workflows/main.yml:290` runs `supabase db push --yes` with no scan, against the rule in
  `docs/ops/prod-db-migrations.md`. **Change.** Scan new migrations for destructive DDL; route those
  through a manual lane.

### 4.2 Rollout verification (T8 remainder) — M

- The path filters were fixed with the app move (`reliability.md` §3f).
- Worker and gateway hooks only check that a `deployment_uuid` came back (`main.yml:425`).
  **Change (M).** Poll until the rollout finishes and the running SHA matches.

### 4.3 Control panel and extension are not checked in CI (A12) — M

- `tsconfig.json:3` excludes `control-panel`; `typecheck:control-panel` (`package.json:25`) never runs in
  CI; nothing builds or typechecks the extension. **Change.** Add both to the `verify` job.

---

## 5. Observability housekeeping

- **Worker retirement (S).** The `hearted-music` Worker is deployed but unrouted since 2026-10-28.
  After a day with zero Worker invocations and no 5xx on the VPS (earliest 2026-10-29 00:56 UTC),
  delete it and the old `production-app` Cloudflare secrets (see `docs/ops/app-server-vps.md`).
- **Kener database is not persisted (S).** Kener (Coolify resource `r8cw0co0wogk0kw4g44kk0sc`) keeps
  its SQLite at `/app/database` with no volume, so a redeploy or container recreate wipes every monitor
  and the ntfy trigger. Add a persistent volume (needs one redeploy). Backup from 2026-10-28:
  `tourflow-vps:/home/ubuntu/kener-backup-20261028.sqlite.db` (taken before the trigger was added).
- **Optional (S).** A Sentry inbound filter on `environment:development` as a backstop to the code gate
  (`src/server.ts:50`, `sentry.client.ts:18`); today only the `localhost` filter is on.
- **Sentry CLI notes.** The binary is `sentry` (not the legacy `sentry-cli`). `issue list` returns null
  counts and timestamps; real numbers are only in `issue view`. `--json` wraps results in
  `{data, hasMore, hasPrev}`. `extra` context appears only in `--json`: use
  `--json | jq '.. | objects | select(has("<key>"))'` before calling an event undiagnosable.

---

## 6. Structural (refactors; separate commits from behaviour changes)

| Id | Change | Where | Effort |
|---|---|---|---|
| N1 | Move persistence out of workflow modules into owning domain/platform modules | `library-processing/queries.ts`, `playlist-sync/lightweight-enrichment.ts`, `enrichment-pipeline/batch.ts`, `stages/matching.ts`, `write-match-snapshot.ts` | L |
| N2 | Last DB-derived `.in()` not covered elsewhere | `playlist-sync/lightweight-enrichment.ts:142` | S |
| N3 | Playlist studio returns `Result` instead of throwing below the boundary | `domains/playlists/candidate-loader.ts:149`; `workflows/playlist-studio/publish.ts:84,90,132,226,229,251` | M |
| N4 | Walkthrough companion songs: one batched read instead of one per id | `src/lib/server/onboarding.functions.ts:608` | M |
| N5 | Parallelise sequential loads | `src/lib/server/dashboard.functions.ts:163-172`; `src/routes/_authenticated/liked-songs.tsx:78,120,125` | S |
| N6 | Defer PostHog and Sentry out of the root route's eager imports | `src/routes/__root.tsx:2,29`; `posthog-sentry-link.ts:1` | M |
| N7 | Matching code owned by taste, not enrichment-pipeline | `match-snapshot-refresh/stages/ranking.ts:19`, `candidate-loading.ts:25`, `domains/taste/song-matching/cache.ts:26` | M |
| N8 | Delete the profile-count mismatch guard; the profiling stage returns one profile per playlist, so it cannot fire | `match-snapshot-refresh/orchestrator.ts:333-337` | S |

Already planned elsewhere: other `.in()` sites (`reliability.md` §2.3, §5.1), liked-songs and matching
empty-on-error (§2.1, §2.3), waitlist rate limiting (§3d).
