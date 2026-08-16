# Architecture & Infrastructure Audit

Date: 2026-08-12
Scope: database/data layer, backend/server functions, React/TanStack frontend, Bun worker/pipelines, operations/CI
Method: five parallel, read-only audit tracks followed by primary-agent verification of every finding retained below. No source code, migrations, CI configuration, production data, or account state was changed.

## Executive summary

The codebase has a strong architectural center: domain vocabulary is explicit, enrichment and matching execute as separate workflows, critical writes increasingly use database RPCs, RLS is backed by CI security invariants, and the unit-test surface is unusually broad. The most serious gaps sit around that center:

1. A production account snapshot containing identity and behavioral data is committed and loaded as the default local seed.
2. Generic durable jobs are leased without attempt ownership, so an executor that resumes after a stale sweep can act on a newer attempt.
3. Library-processing reconciliation is a non-transactional read/derive/full-row-write sequence and can lose concurrent changes.
4. Several pipeline reads fail open, allowing partial syncs or incomplete authoritative match snapshots to be marked successful.
5. CI does not run the load-bearing Postgres integration flows, does not fully classify runtime files for deployment, and does not verify asynchronous worker/gateway deploy completion.
6. Destructive-migration policy is documented but unenforced, while backups share the production VPS failure domain.

These are correctness, privacy, and recovery risks rather than reasons for a speculative rewrite. The highest-leverage work is to remove exposed production data, add attempt fencing, serialize the reconciler, make authoritative pipelines fail closed, and make CI exercise/verify the state transitions it deploys.

## Top 10 correctness and security issues

Ordered by impact, reach, confidence, and effort. Effort includes tests. Fix risk is the risk of changing the behavior, not the risk of leaving it.

### 1. Remove the committed production account snapshot

- **Impact**: Critical privacy exposure. A repository clone or retained git object contains stable production identity, preferences/consent, entitlements, listening timestamps, playlists, and derived enrichment data. The SQL file is also roughly 28 MB of clone/reset weight.
- **Risk/cost if left**: Repository, backup, or collaborator access becomes exposure of identifiable production behavioral data. Removing only the current file would leave prior git objects intact.
- **Effort**: M — replace with a scenario-equivalent synthetic fixture, scrub history, verify clones, and assess the affected account data as exposed.
- **Fix risk**: MED — local development currently depends on the snapshot's breadth.
- **Where**: `scripts/db/seed-user-snapshot.ts:3-18` declares a full production listening/auth snapshot; `scripts/db/seed-user-snapshot.ts:28-29` hard-codes the production identities; `scripts/db/seed-user-snapshot.ts:78-113` exports auth, account, entitlement, library, and playlist tables; `supabase/seeds/prod-snapshot.sql:1-3` identifies the production source; `supabase/seeds/prod-snapshot.sql:17533-17543` contains identity/account/preferences rows; `supabase/config.toml:58-63` loads it on reset.
- **Confidence**: HIGH.
- **Recommended direction**: Commit only synthetic/anonymized seed data. Purge the snapshot from repository history and review history for older non-null credentials; the current snapshot nulls OAuth secrets, so do not claim credential leakage without that history check.

### 2. Fence every generic job attempt to its claiming worker

- **Impact**: Critical state-machine race across enrichment, match refresh, deck jobs, and other generic jobs.
- **Risk/cost if left**: Worker A can lose its heartbeat, be swept, and resume after worker B reclaims the same row. Because no lease token distinguishes the attempts, A can heartbeat, retry, complete, fail, or emit events over B's attempt, causing duplicate provider work, stale publication, conflicting state, and wrong attempt accounting.
- **Effort**: L — schema/RPC/caller changes plus two-worker integration tests.
- **Fix risk**: HIGH — claim, heartbeat, progress, requeue, settlement, and sweep paths all participate.
- **Where**: `supabase/migrations/20260625050000_msr08_preferences_job_availability.sql:47-70` claims by changing status/attempt count without assigning an owner token; `supabase/migrations/20260327200650_add_library_processing_claim_helpers.sql:32-52` re-pends stale attempts; `src/lib/platform/jobs/repository.ts:173-189` heartbeats by ID only; `src/lib/workflows/library-processing/settlement.ts:30-46` requeues by ID/status only; terminal writes at `src/lib/workflows/library-processing/settlement.ts:61-68` and `:159-166` do not even require the expected prior status.
- **Confidence**: HIGH.
- **Recommended direction**: Add `locked_by`/claim token or a monotonically changing attempt token and require `(id, status='running', token)` for every write. Treat zero affected rows as lost ownership. The audio-feature backfill's fenced lifecycle is the local exemplar.

### 3. Serialize library-processing reconciliation and job linking

- **Impact**: High; this is the central control plane for enrichment and match refresh.
- **Risk/cost if left**: Concurrent sync, billing, playlist, and worker-completion changes can overwrite a newer request marker, settlement marker, or active-job reference. A crash after state persistence but before job ensuring can also leave owed work without an active job.
- **Effort**: L — transactional/CAS design and real concurrency tests.
- **Fix risk**: HIGH — scheduling and terminal recovery depend on these semantics.
- **Where**: `src/lib/workflows/library-processing/service.ts:43-69` performs unlocked load, asynchronous metadata reads, reconciliation, then persistence; `src/lib/workflows/library-processing/queries.ts:157-176` overwrites all six workflow columns with only `account_id` as a predicate; effects run later at `src/lib/workflows/library-processing/service.ts:93-118`; active references are written in a second full-row persistence at `src/lib/workflows/library-processing/service.ts:120-126`.
- **Confidence**: HIGH.
- **Recommended direction**: Put each per-account change behind one database transaction using a row/advisory lock or versioned CAS. Persist the state and ensure/link the job atomically, or durably record pending effects in an outbox.

### 4. Fail extension sync when playlist-track persistence is incomplete

- **Impact**: High data-integrity risk.
- **Risk/cost if left**: A playlist lookup failure, missing mapping, or failed per-playlist track mutation is converted into “no change.” The phase and parent can complete, the payload is deleted, and `library_synced` omits the failed target change, leaving membership and downstream matching stale without a corrective request.
- **Effort**: M.
- **Fix risk**: MED — large libraries need explicit partial-success/retry semantics.
- **Where**: `src/lib/workflows/extension-sync/runner.ts:262-265` converts a playlist read failure to an empty map; `:270-278` converts missing mappings and mutation errors to null changes; `:286-302` counts only surviving changes and completes the phase.
- **Confidence**: HIGH.
- **Recommended direction**: Aggregate per-playlist `Result`s and keep the phase retryable unless every requested mutation was durably applied. Include playlist identity in captured diagnostics.

### 5. Abort match refresh when exclusion loading fails

- **Impact**: High correctness violation in the review queue.
- **Risk/cost if left**: A transient exclusion RPC failure is treated as an empty exclusion set, so the newly published snapshot can reintroduce already-decided pairs and songs already present in target playlists.
- **Effort**: S.
- **Fix risk**: LOW — the existing job retry path is safer than publishing known-incomplete data.
- **Where**: `src/lib/workflows/enrichment-pipeline/stages/matching.ts:4-18` documents that exclusion failure must abort; `src/lib/workflows/match-snapshot-refresh/stages/candidate-loading.ts:96-109` catches the error and continues with an empty set; `src/lib/workflows/match-snapshot-refresh/stages/__tests__/candidate-loading.test.ts:127-139` currently pins the fail-open behavior.
- **Confidence**: HIGH.
- **Recommended direction**: Propagate the typed failure so the attempt retries and does not publish.

### 6. Do not replace a complete snapshot with a partial target-playlist set

- **Impact**: High; a transient per-playlist fault becomes authoritative missing data.
- **Risk/cost if left**: Any one target playlist can be dropped after a read/enrichment/profile failure while the remaining subset publishes as the account's complete latest snapshot. Its suggestions disappear until another change happens to request a refresh.
- **Effort**: M.
- **Fix risk**: MED — a permanently malformed playlist must not create endless whole-job retries.
- **Where**: `src/lib/workflows/match-snapshot-refresh/stages/playlist-profiling.ts:55-65` profiles targets independently; failures are swallowed and converted to `null` at `:139-147`; only the all-failed case aborts at `:156-162`; the reduced result is returned at `:164-167` and published as a new snapshot at `src/lib/workflows/match-snapshot-refresh/orchestrator.ts:444-459`.
- **Confidence**: HIGH.
- **Recommended direction**: Separate terminal bad-input cases from operational failures. Retry operational failures or transactionally carry forward prior results for the failed target.

### 7. Run load-bearing Postgres state-machine tests in CI

- **Impact**: High verification gap across money, entitlement, job, and data-integrity paths.
- **Risk/cost if left**: Billing races, idempotency failures, job ingress/lease regressions, and migration-level integrity failures can merge green because normal CI supplies a non-local placeholder DB and those suites self-skip. The local-Supabase job runs only four security invariants.
- **Effort**: M — curate and isolate the highest-value suites; parallelize if runtime requires it.
- **Fix risk**: MED — database fixture isolation and CI duration need care.
- **Where**: `.github/workflows/main.yml:106-116` runs the normal suite without starting Supabase; `vite.config.ts:156-174` supplies a non-local `DATABASE_URL`; `src/lib/domains/billing/__tests__/pack-reversal-and-conversion-race.integration.test.ts:19-29` and `:134` skip without local Supabase; `src/lib/platform/jobs/__tests__/begin-extension-sync.integration.test.ts:13-26` and `:52` do the same; `.github/workflows/main.yml:165-184` starts Supabase but runs only `security-invariants.integration.test.ts`.
- **Confidence**: HIGH.
- **Recommended direction**: Gate a small set of load-bearing integration flows in the existing Supabase job: billing reversal/conversion, entitlement/unlock, generic job reclaim/late-settlement, extension-sync ingress, library-processing concurrency, and match-capture invariants.

### 8. Make CI deployment ownership complete and verify worker/gateway rollout

- **Impact**: High release correctness risk.
- **Risk/cost if left**: Changes to real app entry/config/style files can pass without an app build or deployment, while worker-shared config can deploy only the app. Separately, a green worker job proves only that Coolify accepted two hooks—not that either build succeeded, became healthy, or runs the intended SHA.
- **Effort**: M (path classification is S; rollout verification is M).
- **Fix risk**: MED — asynchronous deployment polling must avoid flaky timing assumptions.
- **Where**: `.github/workflows/main.yml:55-69` omits root app entrypoints such as the Wrangler entry `src/server.ts` (`wrangler.jsonc:6`) and omits `src/env.public.ts`/`src/styles.css`; `src/worker/account-events-gateway.ts:1-3` imports `src/env.ts`, but `.github/workflows/main.yml:62` classifies that file only as app; `.github/workflows/main.yml:347-369` only invokes Coolify hooks; by contrast the app has a production smoke test at `:316-327`; `src/worker/instrument.ts:30-35` exposes a release SHA that CI could verify.
- **Confidence**: HIGH.
- **Recommended direction**: Define path ownership from actual runtime entry graphs and test representative paths. Poll Coolify to terminal success, then probe worker and gateway health/release endpoints for `${{ github.sha }}`.

### 9. Enforce the manual-only/destructive migration boundary

- **Impact**: High production schema/data risk.
- **Risk/cost if left**: The runbook says drops, incompatible renames, type rewrites, long backfills, and lock-heavy DDL are manual-only, but every missing migration is automatically pushed before app/worker rollout. A future contract migration can delete data, block writes, or break still-running old code without a gate.
- **Effort**: M.
- **Fix risk**: MED — naive SQL scanning can false-positive and needs an explicit, protected override path.
- **Where**: `docs/ops/prod-db-migrations.md:45-64` defines additive versus manual-only changes; `.github/workflows/main.yml:186-248` automatically reconciles and pushes every missing migration with `--yes`; `supabase/migrations/20260616150000_drop_walkthrough_match_preview.sql:16-65` demonstrates data deletion, table/type/index drops, and enum-column rewrite; `supabase/migrations/20260619180000_drop_artist_musicbrainz_id.sql:10` directly drops a column.
- **Confidence**: HIGH about the enforcement gap; historical supervision cannot be inferred from repository contents.
- **Recommended direction**: Reject destructive/lock-heavy patterns in the automatic lane unless a reviewed marker routes the file through a protected manual workflow. Keep additive migrations automatic.

### 10. Move production backups out of the production VPS failure domain

- **Impact**: High recovery risk.
- **Risk/cost if left**: VPS loss, compromise, or ransomware can destroy the database and all retained backups together. Current recovery has about a 24-hour RPO even when the host survives.
- **Effort**: L — object storage, encryption, retention, alerting, and restore drills.
- **Fix risk**: LOW — operational configuration rather than application semantics.
- **Where**: `docs/ops/prod-db-backups.md:3-9` stores daily dumps on a persistent Coolify mount; `:65-74` explicitly states VPS loss/compromise is uncovered; `src/worker/db-backup.ts:500-549` writes and rotates only the configured local filesystem artifact.
- **Confidence**: HIGH.
- **Recommended direction**: Replicate completed encrypted dumps to independently controlled object storage and periodically restore one into an isolated PostgreSQL target.

## Additional correctness and security findings

These did not displace the top ten, but are grounded and worth scheduling.

| Priority | Finding | Risk/cost if left | Effort | Evidence |
| --- | --- | --- | --- | --- |
| High | Preserve the extension-sync retry budget for operational failures | Storage/download or transient DB failures terminalize all jobs and delete the only staged payload after one attempt; users must upload the library again. | M | `src/lib/workflows/extension-sync/runner.ts:113-130`, `:136-145` |
| High | Prevent stale onboarding step writes from reopening completed onboarding | A delayed tab can clear the authoritative completion timestamp and regress an account into onboarding. | M | `src/lib/server/onboarding.functions.ts:389-415`; `src/lib/domains/library/accounts/preferences-queries.ts:197-215`; `src/lib/server/onboarding-session.ts:46-59` |
| High | Make preferences creation conflict-safe and preserve read errors | Concurrent first loads can race on insert; a read outage is misreported as an insert/constraint failure. | S | `src/lib/domains/library/accounts/preferences-queries.ts:83-105` |
| High | Stop collapsing required read failures into empty/not-found states | Transient DB faults can be cached/rendered as an empty library, missing song, empty target set, or missing suggestions. | M | `src/lib/server/liked-songs.functions.ts:124-155`; `src/lib/server/playlists.functions.ts:171-193`; `src/lib/server/matching.functions.ts:402-423` |
| Medium | Propagate scheduling reads as typed failures, not false facts | A failed target/playlist read can suppress owed enrichment or refresh work while the triggering change succeeds. | M | `src/lib/workflows/library-processing/service.ts:137-139`; `src/lib/workflows/library-processing/scheduler.ts:154-192`; `src/lib/workflows/extension-sync/runner.ts:403-407` |
| Medium | Rate-limit public waitlist insert-and-email | Anonymous callers can consume table/email quota using unique addresses; external WAF coverage was not visible in-repo. | S | `src/lib/server/waitlist.functions.ts:14-27`, `:43-50` |
| Medium | Serialize overlapping worker drain calls | Timer and LISTEN wake-ups can both pass the capacity check before either claim reserves an active slot, exceeding configured concurrency. | S | `src/worker/poll-loop.ts:63-75`; `src/worker/index.ts:86` |
| Medium | Make authenticated-shell storage state hydration-stable | A previously dismissed unverified-email banner renders on the server and disappears during initial hydration, causing deterministic mismatch/flicker. | S | `src/routes/_authenticated/route.tsx:223-251` |
| Medium | Do not mutate match-refresh edge-detection refs during render | An abandoned concurrent render can consume/arm the running-to-idle edge and leave appended matches stale. | M | `src/routes/_authenticated/match.tsx:224-244`, `:259-303` |
| Medium | Capture operational failures on billing server boundaries | Upgrade-quote and unlock DB failures return opaque client errors without durable capture on load-bearing money paths. | S | `src/lib/server/billing.functions.ts:57-69`, `:99-130`; `src/lib/domains/billing/unlocks.ts:91-128` |
| Medium | Replace skipped match-capture acceptance cases with a DB flow | First-write-wins, ownership, dense rank, idempotency, and empty capture are written as todos around an atomic production RPC. | M | `src/lib/domains/taste/match-review-queue/__tests__/capture-visible-pairs.test.ts:290-327`; production call at `src/lib/domains/taste/match-review-queue/card-materializer.ts:142` |
| Medium | Add CI ownership for control-panel and extension sub-apps | Privileged operator code can change without any CI; extension code lacks package-level typecheck/build verification. | M | `.github/workflows/main.yml:31-48`, `:106-124`; `tsconfig.json:2-3`; `control-panel/README.md:29-39`; `extensions/package.json:6-12` |

## Nice-to-have refactors and performance work

These are not correctness/security blockers and should remain separate from behavior fixes.

### Move persistence to owning domain/platform modules

`docs/architecture/module-boundaries.md:12-21` says workflows orchestrate and persistence belongs to domains/platform. Current workflow modules own table/RPC/raw-SQL access, including `src/lib/workflows/library-processing/queries.ts:95-179`, `src/lib/workflows/library-processing/settlement.ts:11-16`, and `src/lib/workflows/library-processing/scheduler.ts:183-189`. This makes one-writer/CAS policy harder to enforce. **Effort: L; fix risk: MED.** Do structural moves separately from concurrency behavior changes.

### Remove DB-derived `.in()` round trips

The project explicitly bans these because production proxies can return HTTP 414 (`src/lib/data/client.ts:5-29`), but they remain in match metadata (`src/lib/domains/taste/match-review-queue/filter-metadata-queries.ts:86-115`, `:141-150`), library-processing (`src/lib/workflows/library-processing/queries.ts:117-128`; `src/lib/workflows/library-processing/scheduler.ts:162-189`), playlist sync (`src/lib/workflows/playlist-sync/lightweight-enrichment.ts:95-142`), and matching (`src/lib/server/matching.functions.ts:402-406`). **Effort: M–L; fix risk: MED.** Replace with purpose-built RPCs/joins; retain chunking only for externally sourced IDs.

### Restore Result/TaggedError below the playlist-studio boundary

The server adapter directly returns a throwing workflow (`src/lib/server/playlist-draft.functions.ts:109-116`); its candidate loader throws raw DB detail (`src/lib/domains/playlists/candidate-loader.ts:117-151`), and publish logic throws message-string errors (`src/lib/workflows/playlist-studio/publish.ts:73-90`, `:124-138`). **Effort: M; fix risk: MED.** Return `Result<…, TaggedError>` below the server function and translate/capture once at the boundary.

### Collapse the walkthrough companion-song N+1

The endpoint loads a fixed seven-song ID set, then runs `loadWalkthroughSong` once per item (`src/lib/server/onboarding.functions.ts:653-675`). Each item performs two reads and may add an artist read (`src/lib/server/onboarding-session.ts:142-177`), for up to 22 database requests. **Effort: M; fix risk: LOW.** Return the shaped companions through one RPC/join or a small fixed batch while preserving curated order.

### Remove avoidable server and route waterfalls

Dashboard base stats start only after summary/activity finish (`src/lib/server/dashboard.functions.ts:156-175`), and liked-songs loader reads that can be independent are sequential (`src/routes/_authenticated/liked-songs.tsx:73-81`, `:120-127`). **Effort: S; fix risk: LOW.** Start independent promises together and preserve existing fallback branches.

### Defer root observability SDKs

The root route statically imports `PostHogProvider` and the Sentry bridge (`src/routes/__root.tsx:2`, `:29`) even though Sentry's main client is otherwise lazy (`src/lib/observability/sentry.ts:13-25`). The bridge statically imports `@sentry/react` (`src/lib/observability/posthog-sentry-link.ts:1`). This makes both SDKs reachable from every production entry. **Effort: M; fix risk: MED.** Dynamically load analytics/integration while preserving initialization order.

### Clarify matching-code ownership

Runtime enrichment and matching are separate, but ranking/exclusion ownership crosses the boundary: `src/lib/workflows/match-snapshot-refresh/stages/ranking.ts:15` and `candidate-loading.ts:23` import matching code from `enrichment-pipeline`, while `src/lib/domains/taste/song-matching/cache.ts:22` imports upward from a workflow. **Effort: M; fix risk: LOW.** Move pure ranking contracts/constants to the song-matching domain and orchestration to match-snapshot-refresh without behavior changes.

## Areas checked with no finding

- **RLS and routine exposure**: CI starts local Supabase and checks every public table has RLS/policy, anon/authenticated cannot execute public routines, SECURITY DEFINER functions pin `search_path`, and public table grants are absent (`src/lib/data/__tests__/security-invariants.integration.test.ts:38-103`; `.github/workflows/main.yml:165-184`). Source review found no contradictory current migration.
- **Drizzle confinement**: domain queries use Supabase JS/raw Postgres; observed Drizzle usage is confined to Better Auth (`src/lib/platform/auth/auth-request-state.server.ts:5`; `src/lib/platform/auth/auth-schema.ts:15`).
- **Audio-feature backfill fencing**: this subsystem already fences heartbeat/settlement with `locked_by` and has real lifecycle integration coverage (`supabase/migrations/20260718000000_audio_feature_backfill_heartbeat.sql:14`; `src/lib/domains/enrichment/audio-feature-backfill/__tests__/backfill-lifecycle.integration.test.ts:1`).
- **Claim ordering/indexes**: the current library-processing claim applies `available_at`, priority order, and `FOR UPDATE SKIP LOCKED`, with a matching partial poll index (`supabase/migrations/20260625050000_msr08_preferences_job_availability.sql:36-70`).
- **Enrichment/matching execution separation**: enrichment orchestration produces candidate data (`src/lib/workflows/enrichment-pipeline/orchestrator.ts:479`); scoring and publication occur in match-snapshot-refresh (`src/lib/workflows/match-snapshot-refresh/orchestrator.ts:381-459`).
- **Atomic match publication**: snapshot writes go through the hash-deduplicated publication RPC (`src/lib/workflows/match-snapshot-refresh/write-match-snapshot.ts:89`).
- **Reconciler marker semantics**: the pure reconciler settles the request marker the job was satisfying rather than wall-clock completion time (`src/lib/workflows/library-processing/reconciler.ts:130`).
- **Tailwind 4**: Vite plugin, source-aware CSS import, custom variant, and `@theme inline` usage are consistent (`vite.config.ts:300-317`; `src/styles.css:1-11`, `:233-242`). No v3 configuration pattern was found.
- **React state modeling**: representative unlock, checkout, and billing flows use discriminated unions rather than co-occurring booleans (`src/features/liked-songs/hooks/useSongUnlock.ts:9-31`; `src/features/onboarding/hooks/useCheckoutPolling.ts:18-26`; `src/features/billing/components/PaywallCTA.tsx:45-54`).
- **Shutdown/resource cleanup**: worker shutdown stops polling/listeners/sweeps/gateway/telemetry and drains tracked work (`src/worker/index.ts:98`). Representative frontend timers/listeners/observers also clean up.
- **Production migration order and permissions**: production mutation is gated behind verification/security, migrations precede app/worker deploy, and production DB OIDC permission is job-scoped (`.github/workflows/main.yml:186-228`, `:250-265`, `:329-344`).
- **Main CI supply-chain pinning**: third-party actions in `.github/workflows/main.yml` are pinned to full SHAs.

## Verification baseline

- `bun run check`: passed; 1,240 files checked, no fixes applied.
- `bun run typecheck`: passed.
- `bun run typecheck:worker`: passed.
- `bun run test`: 367 test files / 4,052 tests passed; 52 tests skipped; 11 todo. The 102 failures across 22 integration files were all caused by local Supabase being unavailable (`ECONNREFUSED` on `127.0.0.1:54321/54322`), first under sandbox restrictions and then again with local-network permission. They are not treated as product failures. This run itself demonstrates that a valid local Supabase service is required to verify the DB-backed findings.

## Audit limits

- No live production catalog, `EXPLAIN (ANALYZE, BUFFERS)`, production RLS state, Coolify configuration, GitHub environment reviewer settings, Tailscale ACLs, hosted secrets, deploy hooks, or backup restore was inspected.
- Dependency vulnerability resolution was not completed; network access for an audit command was unavailable, so this report makes no vulnerability claim.
- The control panel was assessed only for CI ownership, not comprehensively reviewed as a UI/backend. The extension was assessed only for CI ownership and its role in sync architecture.
- Existing uncommitted landing-page and root-route changes were treated as user work and excluded from authorship; no source finding was “fixed” during the audit.
- Findings are based on the repository state at commit `ddd21ba1` plus the user's existing uncommitted files visible on 2026-08-12.

## Recommended execution order

1. Contain the production-data exposure: replace the seed and plan a history scrub.
2. Add characterization/concurrency tests for attempt fencing and library-processing races.
3. Implement attempt ownership, then transactional/CAS reconciliation.
4. Make exclusion/profile/sync paths fail closed and exercise them through real Postgres flows.
5. Expand CI's local-Supabase gate, then fix deploy ownership and rollout verification.
6. Enforce migration classification and add offsite backup/restore drills.
7. Only after behavior is protected, take the structural/performance refactors as separate changes.
