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
worker's settlement retries. 2.3 (partial target-playlist set) and 2.1 (extension sync dropping failed
playlist-track writes and failing on its first transient error) are fixed too.
Retry machinery today: enrichment and match-refresh jobs requeue on a throw while `attempts < 3`, with
30 s × attempt backoff (`library-processing-runner.ts:184-233`, `finalize.ts:38-59`). Extension sync
requeues the same way on a transient DB or apply error, keeping its payload
(`extension-sync-runner.ts:201`); its claim honours `available_at`.

### 2.5 Unverified: crash between state write and job creation (T3 note) — S

- `idle-recovery.ts` recovers enrichment when the process dies after the state write but before the job
  exists. Check whether a match refresh can be stranded the same way; add a recovery path if so.

### 2.6 Remaining reads silently capped at 1,000 rows — M

- PostgREST truncates every response at `max_rows` = 1,000 with no error (`supabase/config.toml:18`,
  same in prod). The overflowing sync, membership and exclusion reads are paged (PRs #66–#69). These
  remain single-request:
  - `getBootstrapPagesBySlug` (`library/liked-songs/queries.ts`). Libraries reach 5,044 songs. A deep link to a
    song past row ~1,000 loses its anchor, silently falls back to the first page, and the panel stays
    closed.
  - Review queue: `session-appender.ts:236` (`match_review_proposal_subject`) and `fetchQueuedSongIds` /
    `fetchQueuedPlaylistIds` (`match-review-queue/queries.ts`). Not measured. Subjects past the cut are
    never appended, and songs already queued get queued again.
  - `getMatchRankingsForPlaylist` (`song-matching/queries.ts:218`). Prod sits at exactly 1,000; the next
    refresh of account `8ce63d2d…` puts about 2,500 rankings on one playlist. Mild: the read is ordered
    by `rank`, so pairs past the cut become "unranked" and are sorted by fit score.
  - `getNewItemIds` (`liked-songs/status-queries.ts:32`). Reaches 3,659. Mild: the newness ordering of
    review subjects is incomplete.
- **Not yet checked.** Write responses that `.select()` many rows (e.g. the `setPlaylistTargets` clear
  step in `playlists/queries.ts`); hidden `LIMIT`s inside other RPCs' SQL.
- **Change.** Page each read with a unique order (offset paging only for read-before-write; keyset when
  rows can drop out between pages, as `visibility-inputs.ts` does), or push the predicate into SQL.

---

## 3. Server-fn correctness

### 3.4 Match-refresh refs mutated during render (A9) — M

- `src/routes/_authenticated/match.tsx:236-244`. **Change.** Move the edge detection into an effect or
  derive it from query state.

---

## 4. CI and deploys

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
- **VPS disk alert (S).** On 2026-10-28 the 72 GB disk, which also holds prod Postgres, reached 99%:
  Coolify kept a 1.9 GB build image per commit for the worker and gateway, and two app deploys failed
  with `no space left on device`. Since then, Coolify's Docker cleanup runs hourly, keeping 2 images per
  app, and app deploys reuse unchanged layers (PR #65). Nothing alerts before the disk fills.
  **Change.** Alert on disk usage (Kener or ntfy).
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
