# Free-Plan Sync Architecture — Implementation Plan

**Goal:** Make `POST /api/extension/sync` work reliably on Cloudflare Workers **Free** plan and Supabase **Free** plan, for any library size, with no app-level polling as the primary mechanism.

**Status:** Ready for implementation. All platform constraints below were verified against vendor docs/issues on 2026-06-12.

---

## 1. Problem

The extension sync endpoint (`src/routes/api/extension/sync.tsx`) does all library writes inline in one Cloudflare Worker invocation. Production failure observed: `Too many subrequests by single Worker invocation` → HTTP 500, with partial data written.

Measured/derived costs of the current request:

- ~27 subrequests minimum even for a tiny library (auth, stale sweep, gate checks, 3 job inserts, preferences update, 6 job lifecycle writes, library-processing apply ~6–16, billing grant ~3–7).
- Data writes scale with library size: chunked PostgREST calls at 500 rows/write and 100 ids/`.in()` filter (`src/lib/shared/utils/chunked-write.ts`), plus ~4–6 subrequests **per playlist** in phase 3 (`mapWithConcurrency` at 4).
- ~136 ms CPU observed (20 MB `JSON.parse` + Zod), vs a 10 ms Free-plan CPU budget.
- A ~289-song / 8-playlist library already blows the 50-subrequest cap.

## 2. Verified platform constraints (do not re-litigate; sources checked 2026-06-12)

| Constraint | Value | Source |
|---|---|---|
| CF Workers Free: subrequests per invocation | **50** (Paid: 10,000) | developers.cloudflare.com/workers/platform/limits |
| CF Workers Free: CPU per invocation | **10 ms** | same |
| CF request body max (Free account) | 100 MB | same |
| Supabase Free: pg_cron | **Available** ("Cron is only limited by the resources it uses … on any tier" — maintainer) | github.com/orgs/supabase/discussions/37405 |
| Supabase Free: Realtime | Included; 200 peak concurrent connections | supabase.com/docs/guides/realtime/limits |
| Supabase Free: Storage | 1 GB total, **50 MB max per file** | supabase.com/docs/guides/storage/uploads/file-limits |
| Supabase Free: direct DB connection | **IPv6-only**; IPv4 add-on NOT purchasable on Free | supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility |
| Supavisor session mode (port 5432) | Supports LISTEN/NOTIFY and prepared statements; works over IPv4 | supabase.com/docs/guides/troubleshooting/supavisor-faq |
| Supavisor transaction mode (port 6543) | **No LISTEN/NOTIFY** — never use for the listener | supabase/supavisor#85, Supavisor FAQ |
| PostgREST request body size | **UNVERIFIED** — 413 reports at ~1 MB exist (2021, github.com/orgs/supabase/discussions/4639); current hosted limit undocumented | — |
| `pg_notify` payload | 8000 bytes max — send only job id/type, never data | Postgres docs |
| PostgREST `max_rows` | 1000 rows per response (why `chunked-write.ts` exists) | noted in `chunked-write.ts:10` |

**Consequence of the UNVERIFIED row:** do NOT stage the 20 MB payload through a PostgREST insert/RPC. Stage it in **Supabase Storage** (50 MB/file confirmed). This also keeps payloads out of the 500 MB Free-plan database.

## 3. Target architecture

```
Extension ──POST /api/extension/sync (≤20MB body)──▶ CF Worker (thin ingress, ~5 subrequests, ~0 CPU)
                                                       1. auth (1–2)
                                                       2. stream raw body → Storage object (1)
                                                       3. rpc begin_extension_sync(path) (1)  ── atomically: gate, stale-sweep,
                                                       4. PostHog (1)                            create jobs, prefs, pg_notify
                                                       └─ 202 { phaseJobIds, queued: true }

Postgres ──NOTIFY job_created──▶ Bun worker (Coolify, src/worker/) — LISTEN on session-mode conn
                                   claim (SKIP LOCKED) → download payload from Storage → Zod validate
                                   → run phases (existing TS sync code, no subrequest/CPU limits)
                                   → job progress updates → delete Storage object

Web app  ◀──Supabase Realtime (job row changes)── push status
Extension ◀──slim status endpoint (1 subrequest/poll, own invocation)── fallback
```

Why this shape:

- **Endpoint cost becomes constant (~5 subrequests)** regardless of library size — 10% of the Free cap.
- **Streaming body → Storage avoids `JSON.parse`/Zod in the Worker** → CPU drops from ~136 ms to ~1–2 ms, inside the 10 ms Free budget.
- **The Bun worker reuses the existing TypeScript sync code unchanged** (it's all supabase-js, runs identically under Bun) — no plpgsql rewrite of diff logic.
- **The single `begin_extension_sync` RPC closes a real race**: today `getActiveSync` check → `createJob` is not atomic; two concurrent syncs can both pass the gate.
- **LISTEN/NOTIFY replaces the 5s poll timer**; pg_cron replaces app-level sweep timers. NOTIFY is at-most-once, so sweeps stay as the safety net.

## 4. Key repo anchors

| What | Where |
|---|---|
| Sync route + inline orchestration | `src/routes/api/extension/sync.tsx` (Zod schemas at lines ~90–165, body cap logic ~139–143, phases ~405–741) |
| Sync helpers | `src/lib/workflows/spotify-sync/sync-helpers.ts` |
| Job repo / lifecycle / phase jobs | `src/lib/platform/jobs/{repository,lifecycle,sync-phase-jobs}.ts` |
| Claim RPC pattern to clone | `supabase/migrations/20260327200650_add_library_processing_claim_helpers.sql`, `src/lib/platform/jobs/library-processing-queue.ts:189` |
| RPC hardening pattern | `supabase/migrations/20260519110000_harden_internal_rpcs.sql` |
| Bun worker entry / poll / sweep | `src/worker/index.ts`, `src/worker/poll.ts` (dispatch switch at ~line 14), `src/worker/sweep.ts` |
| Job runner pattern to mirror | `src/lib/workflows/library-processing/runner.ts` (`runClaimedJob`) |
| Heartbeats | `src/worker/execute.ts` (`startHeartbeat`) |
| Admin supabase client | `src/lib/data/client.ts` (service-role; `.storage` is available on it — currently unused anywhere in repo) |
| Extension token auth | `src/lib/platform/auth/extension-api-tokens.ts:72–91` (note: does a separate `last_used_at` update — fold into one RPC) |
| Post-sync tail to relocate | `applyLibraryProcessingChange` (library-processing `service.ts`), billing grant (`liked-song-access-grant.ts`) |
| Chunked writes (stays for worker use) | `src/lib/shared/utils/chunked-write.ts`, `concurrency.ts` |
| Body streaming util | `src/lib/server/request-body.ts` (`readBodyWithByteCap`) |
| RLS policies | `supabase/migrations/20260116160005_add_rls_policies.sql` |
| Worker Docker | `Dockerfile.worker` (Bun 1.3.14; `DATABASE_URL` already used by `src/worker/db-backup.ts`) |

Project conventions: bun for everything, tests via `bun run test` (Vitest) into `tests/`/`__tests__/`, no barrel exports, comments explain WHY only, migrations under `supabase/migrations/` (use the `supabase-local` skill flow for local apply).

## 5. Pre-flight checks (do these first, ~15 min)

1. **Storage 20 MB standard upload from a CF Worker**: script a `supabase.storage.from(bucket).upload()` of a ~25 MB JSON blob against the project. Supabase recommends resumable (TUS) above ~6 MB; standard upload should still accept it (hard cap is the 50 MB file limit), but confirm empirically. If standard upload is flaky at 20 MB, fall back to: extension uploads via signed upload URL (`createSignedUploadUrl`) and POSTs only the object path to the sync endpoint.
2. **Worker host connectivity**: confirm the Coolify host can reach the Supabase **session-mode pooler** (port 5432 on the `*.pooler.supabase.com` host — works over IPv4). Direct connection requires IPv6 on Free. Needed for Phase 4 (LISTEN).
3. Note current `job_status`/`job_type` enum values and the exact active-sync gate semantics in `sync-phase-jobs.ts` before writing the RPC.

## 6. Implementation phases

Ship order matters: Phases 1–3 fix the production 500s; 4–5 remove polling; 6 is optional perf.

### Phase 1 — Database migration (new SQL migration)

1. `ALTER TYPE job_type ADD VALUE 'extension_sync';` (parent job; the three existing `sync_*` types remain as phase jobs).
2. Create private Storage bucket via migration: `insert into storage.buckets (id, name, public) values ('sync-payloads', 'sync-payloads', false);` No anon/authenticated storage policies — service-role access only.
3. `begin_extension_sync(p_account_id uuid, p_payload_path text, p_payload_bytes bigint) returns jsonb`, SECURITY DEFINER, pinned `search_path`, EXECUTE revoked from `anon`/`authenticated` (copy the hardening pattern from `20260519110000_harden_internal_rpcs.sql`). In one transaction:
   - take `pg_advisory_xact_lock(hashtext('extension_sync:' || p_account_id))` to serialize concurrent syncs per account;
   - run the stale-job sweep (reuse `mark_stale_extension_sync_jobs` logic);
   - if an active sync exists → return `{"active": true, "jobId": ...}` (endpoint maps to today's 409/conflict response);
   - enforce the cooldown check currently done via `getLastCompletedSync`;
   - insert parent `extension_sync` job (`status='pending'`, payload path + byte count in `progress` jsonb) + the three phase jobs (`sync_liked_songs`, `sync_playlists`, `sync_playlist_tracks`, all pending);
   - update `user_preferences.phase_job_ids`;
   - `pg_notify('job_created', json_build_object('id', parent_id, 'type', 'extension_sync')::text);`
   - return `{"jobId": ..., "phaseJobIds": {...}}`.
4. `claim_pending_extension_sync_job()` — clone `claim_pending_library_processing_job` (SKIP LOCKED, sets running/attempts/heartbeat) targeting `type = 'extension_sync'`.
5. Optional now / required by Phase 4: `AFTER INSERT ON job` trigger firing `pg_notify('job_created', ...)` when `status='pending' AND type IN ('extension_sync','enrichment','match_snapshot_refresh','walkthrough_match_preview')` — generalizes the wake-up beyond sync. (If added, drop the explicit notify inside the RPC to avoid double-fire; double-fire is harmless anyway.)
6. `validate_extension_token(p_token_hash text)` — returns the token row's account and stamps `last_used_at` in one call (replaces the select + fire-and-forget update in `extension-api-tokens.ts`, saving a subrequest).

### Phase 2 — Slim the sync endpoint (`src/routes/api/extension/sync.tsx`)

1. Extract the Zod schemas (`SyncPayloadSchema` etc., lines ~90–165) into a shared module, e.g. `src/lib/workflows/spotify-sync/payload-schema.ts`, so the Bun worker can import them. No barrel exports.
2. Endpoint flow becomes:
   - auth (session, else `validate_extension_token` RPC) — 1–2 subrequests;
   - enforce Content-Length / streamed byte cap (keep `MAX_SYNC_BODY_BYTES = 20 MB`), but **do not `JSON.parse` or Zod-validate the body**;
   - upload the raw bytes to `sync-payloads/{accountId}/{crypto.randomUUID()}.json` with the admin client (`contentType: 'application/json'`) — 1 subrequest;
   - call `begin_extension_sync(accountId, path, byteLength)` — 1 subrequest; map `{active:true}` to the existing conflict response;
   - PostHog capture (byte size + counts unknown at this point — send byte size only) — 1 subrequest;
   - return **202** `{ ok: true, queued: true, phaseJobIds }`.
3. Delete the inline phase orchestration, user-profile update, library-processing apply, and billing grant from the route — all move to the worker (Phase 3). Keep the route's request-shape errors (411/413) intact.
4. **Extension contract change:** the response no longer contains per-phase `results`; it already contains `phaseJobIds`. Invalid payloads now fail asynchronously (job → `failed` with the Zod error) instead of 400 inline. Coordinate the extension release; if a transition period is needed, gate the new behavior behind a header/flag the new extension version sends.

### Phase 3 — Bun worker handler

1. New runner `src/lib/workflows/extension-sync/runner.ts`, mirroring `library-processing/runner.ts`:
   - download payload from Storage via admin client; `SyncPayloadSchema.parse` (full validation lives here now);
   - run the orchestration extracted from the old route: user-profile update → phase 1 liked songs → phase 2 playlists → phase 3 playlist tracks, using the existing `startJob`/`completeJob`/`failJob` on the three phase jobs and the existing helpers (`importLikedTracks`, `syncPlaylists`, `syncPlaylistTracksFromData`). PostgREST chunked writes are fine here — no subrequest cap in Bun;
   - then the post-sync tail: `applyLibraryProcessingChange`, `maybeGrantLikedSongAccessAfterSync`;
   - on success: complete parent job, **delete the Storage object**; on failure: fail parent job with error, delete the object too (the payload is reproducible by re-syncing; keeping failures would erode the 1 GB Storage quota);
   - heartbeat via `startHeartbeat` for the parent job.
2. Wire into `src/worker/poll.ts`: claim via `claim_pending_extension_sync_job()` alongside the existing claim, add an `extension_sync` case to the dispatch switch. Respect `WORKER_CONCURRENCY`.
3. Extend `src/worker/sweep.ts` (or the existing stale RPCs) to cover `extension_sync` jobs, and add an orphaned-payload sweep: list `sync-payloads` objects older than e.g. 24 h with no pending/running job and delete them.

### Phase 4 — Replace polling with LISTEN/NOTIFY

1. Add a listener module in `src/worker/` using `Bun.sql` or `postgres.js` with `DATABASE_URL` pointing at the **session-mode pooler (port 5432)** — never transaction mode (no LISTEN support, verified). One dedicated connection, `LISTEN job_created`; on notification, immediately trigger a claim cycle for the notified type.
2. Keep the existing poll loops as the at-most-once-delivery safety net, interval raised from 5 s to 30–60 s. Reconnect with backoff on listener connection loss (and run a claim cycle on reconnect to catch missed notifications).
3. Optional: move the stale/dead sweeps to **pg_cron** (verified available on Free): `select cron.schedule('sweep-stale-jobs', '* * * * *', $$select sweep_stale_library_processing_jobs('5 minutes'); select mark_dead_library_processing_jobs('5 minutes');$$);` and remove the worker's sweep timer. Keep whichever is simpler to observe; don't run both at aggressive intervals.

### Phase 5 — Status delivery without app polling

1. **Web app (push):** add the `job` table to the `supabase_realtime` publication and an RLS SELECT policy letting an authenticated user read only their own account's job rows (follow the join pattern in `20260116160005_add_rls_policies.sql`; the table currently has no user-facing read path since everything uses the service role — verify before writing the policy). Subscribe to changes on the ids in `user_preferences.phase_job_ids`. Free-plan Realtime quota (200 concurrent) is far above current scale.
2. **Extension (cheap pull):** slim `GET /api/extension/sync/status` returning the 3 phase-job rows in **one** PostgREST call (`.in("id", ids)`). Each poll is its own Worker invocation (~2–3 subrequests against a fresh 50 budget), so client polling is harmless to the cap. Do NOT build an SSE endpoint on the CF Worker — an SSE handler polling the DB consumes its own invocation's subrequest budget per tick and self-strangles.
3. Future option (not now): mint a short-lived Supabase JWT at sync start so the extension can use Realtime directly.

### Phase 6 — Optional: set-based SQL in the worker

Pure performance/atomicity, not needed for correctness (Phase 3 already works via PostgREST):

- Replace chunked PostgREST writes in the worker path with single-statement upserts over the session-pooler connection: `INSERT ... SELECT ... FROM jsonb_to_recordset($1) ON CONFLICT ... DO UPDATE`, one transaction per phase. A 19k-track library becomes ~5 statements instead of ~80 chunked HTTP calls, and a phase can no longer be half-written.
- If done, `chunked-write.ts` remains in use only by non-sync paths; do not delete it speculatively.

## 7. Acceptance criteria

1. `bun run test` passes; new Vitest coverage for: `begin_extension_sync` semantics (gate, cooldown, race — can be tested against local Supabase via the `supabase-local` flow), the extracted payload schema module, and the worker runner (mock Storage + DB as existing worker tests do, e.g. the terminal-recovery test pattern).
2. `wrangler tail` on a real sync: the `/api/extension/sync` invocation makes **≤ 10 subrequests** and returns 202 in well under a second; no `Too many subrequests` warnings anywhere in the sync flow.
3. End-to-end on local: the previously failing ~289-song / 8-playlist library syncs fully via the worker; all 4 job rows reach `completed`; the Storage object is deleted; library-processing and billing-grant effects fire as before.
4. Large-library fixture (~19–20k tracks, near the 20 MB cap) completes via the worker without errors.
5. Worker pickup latency after Phase 4 is sub-second (observe NOTIFY → claim in worker logs); killing the listener connection does not strand jobs (fallback poll/sweep claims them).
6. Status: web app receives Realtime job updates; extension status endpoint returns phase progress in one subrequest.

## 8. Risks & mitigations

- **Storage standard upload at 20 MB** — pre-flight check #1; fallback is signed-URL upload from the extension (also removes the body from the Worker entirely).
- **Async validation UX** — bad payloads fail in the worker, not inline. Surface the Zod error message in the job `error` column so the extension can show it.
- **Worker availability becomes load-bearing for sync** — already true for enrichment; stale sweeps + pending jobs queue safely while it's down. Ensure Coolify healthcheck (port 3002) alerts.
- **Storage quota (1 GB Free)** — objects are transient; delete on completion AND failure, plus the orphan sweep (Phase 3.3).
- **NOTIFY at-most-once** — fallback poll at 30–60 s + claim-on-reconnect covers it; never remove the fallback.
- **Migration enum gotcha** — `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block with subsequent use of the value in the same migration on some setups; if the Supabase migration runner wraps migrations in a transaction, split the enum addition into its own migration file.

## 9. Out of scope

- Paid-plan anything (the point is staying on Free for both vendors).
- Chunked/TUS upload for >20 MB payloads (raise `MAX_SYNC_BODY_BYTES` later if a real user exceeds it).
- Realtime auth for the extension (JWT minting) — fallback polling is fine.
- Deleting `chunked-write.ts` or other PostgREST plumbing still used elsewhere.
