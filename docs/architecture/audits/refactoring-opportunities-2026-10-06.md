# Refactoring opportunities: architecture audit (2026-10-06)

Read-only audit of `src/` and `shared/` (~110k non-test lines). `extensions/` and `control-panel/` are covered only where they share a contract with the app. The bar is the CLAUDE.md design principles, especially the deletion test and "structure is earned by present need". Earlier audit documents in `docs/` were not consulted.

**Method.** Eight parallel sub-audits each covered one or two of the twelve areas. Every finding below was then confirmed by opening the cited files. Claims that could not be confirmed were cut. For example, a reported reranker slicing bug turned out not to happen on sorted input, and a reported "three identical debounce hooks" turned out to be one hook. Where part of a finding rests on something not observable from the repo (prod config, frequency), it is marked **PLAUSIBLE**. Everything else is **CONFIRMED**.

**Size scale.**

| Size | Files | Migration |
|---|---|---|
| XS | 1–2 | — |
| S | ≤ 5 | none |
| M | 5–15, or one migration | possibly |
| L | 15+ | + migration + openspec |

---

## Summary

The layering mostly holds. The pure cores are genuinely pure: reconciler, failure policy, visibility policy, draft engine, scoring, and billing state. The job claim paths are well built. The mess sits at four seams:

1. **A few state writes that are not compare-and-set.** One of them silently un-completes onboarding (#1).
2. **Read models assembled at the wrong layer.** Match visibility is rebuilt per caller and has already drifted (#3). The deck read model lives inside a server-fn file (#11). Entitlement reads live inside the enrichment workflow (#6).
3. **Matching code filed under enrichment and billing orchestration filed under domains.** These produce every domain→workflow import (#8, #9).
4. **One logging path that never reaches Sentry,** combined with swallowed errors (#4).

Nothing enforces the boundaries today. Biome `noRestrictedImports` overrides plus TanStack Start's `importProtection` cover nearly all of it (see [Rules worth enforcing](#rules-worth-enforcing-mechanically)).

---

## Lead verification

The grep leads from the brief, re-measured with tests, stories, mocks and generated files excluded. The sub-audits did the counting; the rows marked ✓ were re-run during verification.

| Lead | Measured | Note |
|---|---|---|
| 5 domain files import workflows | 5 files / 10 lines ✓ | 4 billing/backfill files → library-processing, plus `taste/song-matching/cache.ts` → enrichment-pipeline |
| 2 integrations import domains | 2 ✓ | `integrations/audio/service.ts` (value), `reccobeats/file-analysis.ts` (type) |
| 5 `src/lib` files import features | 5 files / 8 lines ✓ | 3 type-only; `lib/hooks/useAccountEvents.ts` and `useActiveJobs.ts` import runtime values |
| ~65 feature→feature lines | 65 (+3 in stories) ✓ | Most are legitimate reuse; see "deliberately not on the list" |
| 78 feature files import `lib/domains` | 68 non-story; 119 statements, 80 `import type` | One real client-bundle leak (#2) |
| 47/150 domain files touch Supabase | 43/148 | The lead counted `Array.from`. 24 of the 43 are `*queries*` files |
| 5 workflow files query tables | **9** | `batch`, `content-activation`, `stages/matching`, `write-match-snapshot`, `lightweight-enrichment`, `library-processing/{queries,scheduler,settlement}`, `extension-sync/runner` |
| 9 `lib/server` files query tables | 10 (25 calls) | Plus 2 API routes and 1 feature file |
| ~93 `.rpc(` / 35 files | 93 / 35 | All typed by name via generated `Functions`. Json-returning RPCs are then cast (#15) |
| ~70 `.in(` in src/lib | 47 real calls | 12 literal status lists (fine), 35 id lists, ~15 of them DB-derived (#3, #5, #6) |
| ~36 / ~43 throws (domains / workflows) | 37 / 43 | 58 `throw new Error(` in total; none passes `{ cause }` (#4) |
| ~40 try blocks | 40 (13 + 27) | Mostly legitimate; see "deliberately not on the list" |
| 72 `createServerFn` / 20 files, 3 outside `lib/server` | 68 in 20 files + **4 calls in 3 files** outside ✓ | `routes/index.tsx` ×2, `routes/auth/logout.tsx`, `features/playlists/create/intentEligibility.ts` |
| 13 domain/workflow Zod-parse files | **1** parse-once violation ✓ | All others parse external, jsonb or LLM input (legitimate) |
| 31 `as unknown as` | 33 lines, ~14 real in `src/lib` ✓ | The rest are Ladle stubs and story fixtures |
| 36 `as any` | 38 lines, **2 in production** ✓ | 34 are in `routeTree.gen.ts`; the 2 are both in `providers/adapters/local.ts` |
| 25 env-reading files | 23 outside the env modules | About half are Vite built-ins (fine); ~12 bypass a typed module |
| ~112 `console.*` in src/lib | 113 | Plus 16 in routes, 8 in features |
| 133 `useEffect` / 88 boolean `useState` | 133 / 88 | 13 of the 88 are in `SongDetailPanelSurface.tsx` |
| 6 inline query keys | 6 (4 true literals) | Bigger issue: who owns invalidation (#16) |

## Intended layering (as the code mostly follows it)

```
routes (pages)            routes/api/** (HTTP edge, peer of lib/server)      src/worker (host)
   │                               │                                            │
features ─► lib/server/*.functions.ts ─────────────────────────────────────────┤
   │               │                                                            │
client infra       └──► workflows ──► domains ⇄ platform ──► integrations ──► lib/shared, lib/data
(lib/hooks, extension,                    │                                    observability, env
 keyboard, theme, consent)                └──► account-events/producer
shared/ (top level): cross-app wire contracts; imports nothing from src/
```

Domains and platform are peers. Feature code may import domain *types* and *pure* modules, never IO modules.

---

## Ranked findings

Ranked by leverage across all areas: correctness risk × breadth ÷ cost.

### 1. Saving any onboarding step silently un-completes onboarding

- **Areas:** 7, 4
- **Files:**
  - `src/lib/domains/library/accounts/preferences-queries.ts:181-199` (`updateOnboardingStep`), and the CAS writer `:213-228` (`completeOnboarding`)
  - `src/lib/server/onboarding.functions.ts:389-411` (`saveOnboardingStep`) and `:597-604` (second writer)
  - `src/lib/domains/billing/unlocks.ts:220-245`
- **Today:**
  - `updateOnboardingStep` upserts `{ onboarding_step, onboarding_completed_at: null }`, keyed only on `account_id`.
  - Completion itself is a careful compare-and-set (`.is("onboarding_completed_at", null)`), but every later step save undoes it unconditionally.
  - The null reset came in with `b6a0b45e` ("fix(devtools): allow navigating back from complete in UIPane onboarding"). A devtools convenience became the production write.
  - A stale second tab, or a step save that lands after completion, re-opens onboarding. Re-completing then re-runs `completeOnboardingWithAllocations` → `grantFreeAllocation`, which tops active unlocks back up to `FREE_ALLOCATION_LIMIT`.
  - Separately, `commitDemoSongAndEnterWalkthrough` writes `onboarding_step` through its own raw `.update` at the server-fn boundary, so the column has two writers.
- **Proposed shape:**
  - The step writer becomes `update … .eq("account_id") .is("onboarding_completed_at", null)` and never touches `completed_at`.
  - The demo-song + step write moves into `preferences-queries` as the column's second, named transition. That file then owns every write.
  - Devtools gets an explicit dev-only reset instead of piggybacking on the production write.
- **Deleted:** the `onboarding_completed_at: null` line and the raw update in `onboarding.functions.ts`.
- **Change type:** behavior change (bug fix). Add one regression test, since this sits on the entitlement path.
- **Size:** S.
- **Openspec:** no. It restores the completion semantics the code already intends.
- **Verdict:** CONFIRMED mechanism; frequency in prod not measured.

### 2. Server-only modules ship in the client bundle

- **Areas:** 1, 9
- **Files:**
  - `src/features/liked-songs/components/song-detail-panel/song-detail-adapter.ts:21`
  - `src/lib/domains/enrichment/content-analysis/song-analysis.ts:1-38`
  - `src/features/feedback/UserJotWidget.tsx:3`
  - `src/env.ts:63-66,123`, `src/env.public.ts:18`
- **Today:**
  - The adapter value-imports one Zod schema (`SongAnalysisInstrumentalSchema`) from `song-analysis.ts`. That module imports `./queries`, `./llm-usage-queries`, `../lyrics/queries`, `./prompts/registry` (15 prompt files) and `./voice/rewrite-pass` (the 768-line `tier1-rules`).
  - `dist/client/assets/liked-songs-BoaLgBqN.js` contains the lyrical-v17 prompt body ("Pick the family the song feels like") and the `lyrical-v23…v30` ids. That build is from 2026-08-28, but the adapter import has not changed since `946ee291` (2026-06-12).
  - `UserJotWidget` imports `@/env` (the t3 server+client schema) because `env.public.ts` lacks `VITE_USERJOT_PROJECT_ID`. The main chunk carries server variable *names* such as `SUPABASE_SERVICE_ROLE_KEY`. Names only; no values.
  - The two client env modules disagree. `VITE_PUBLIC_APP_ORIGIN` is optional in `env.ts` and required in `env.public.ts`.
  - Raw bypasses of declared vars: `lib/extension/transport.ts:28-30`, `lib/hooks/useAccountEvents.ts:291`, `src/utils/posthog-server.ts:20,24`, `src/server.ts:78`.
- **Proposed shape:**
  - Move `SongAnalysisInstrumentalSchema` into `content-analysis/read-schema.ts`, which is already pure Zod and already imported by the adapter.
  - Make `env.public.ts` the only client env module: add the missing `VITE_` vars, delete `env.ts`'s `client:` block, and point the bypasses at `clientEnv`.
  - Add a `client.files` deny list to TanStack Start's `importProtection` so this cannot regress. `@tanstack/start-plugin-core` 1.170.6 exposes `importProtection.client.{files,specifiers}` with `behavior: "error"|"mock"`. Deny `src/env.ts`, `lib/data/client.ts`, `lib/workflows/**`, `lib/integrations/**`, `content-analysis/prompts/**` and `src/worker/**`.
- **Deleted:** `env.ts`'s client block and its VITE `runtimeEnv` lines.
- **Change type:** bundle-only. No runtime behavior change.
- **Size:** S (~7 files + `vite.config.ts`).
- **Openspec:** `refactor-env-to-varlock` overlaps the env half. That change is stale: last touched 2026-03-10, and its tasks name `app.config.ts`, `src/lib/ml/*`, `src/lib/capabilities/*` and `src/lib/auth.ts`, none of which exist, and it predates `env.public.ts`. Archive or rewrite it rather than wait on it.
- **Verdict:** CONFIRMED. A fresh `bun run build` would re-confirm the chunk contents; it was not run, to keep the session read-only.

### 3. Match-visibility inputs are hand-assembled per caller, and liked-songs suggestions ignore playlist filters

- **Areas:** 2, 6, 5
- **Files:**
  - `src/lib/domains/taste/match-review-queue/service.ts`, `eligible-subjects.ts`, `visible-suggestion-list.ts:155-175,289,379-407`, `queries.ts:477`, `filter-metadata-queries.ts`
  - `src/lib/server/matching.functions.ts:314-406`
  - `src/features/liked-songs/queries.ts:80`
- **Today:**
  - Four modules each read match pairs from the DB, derive song and playlist ids, then feed those ids back through chunked `.in()` reads: decisions, song filter metadata, owned playlists, playlist `match_filters`. 31 such call sites across `service.ts` (11), `visible-suggestion-list.ts` (10), `eligible-subjects.ts` (7) and `matching.functions.ts` (3).
  - The CLAUDE.md rule is that DB-derived id sets never re-enter as `.in()` filters.
  - `fetchOwnedPlaylistIds` is defined twice: `queries.ts:477` (exported) and `visible-suggestion-list.ts:289` (private).
  - The copies have drifted. `getSongSuggestions`, which feeds the liked-songs detail panel, builds `MatchPairInput` with no `playlistFilters` and no `songMeta` (`matching.functions.ts:375-380`). `passesPlaylistFilters` treats a missing filter config as a pass (`visible-suggestion-list.ts:171-174`).
  - Result: the panel suggests playlists whose match filters hide that same song in the deck.
- **Proposed shape:**
  - One loader in `match-review-queue/queries.ts`, `loadVisibilityPairs({ accountId, snapshotId, songId? | playlistId? })`.
  - It is backed by one RPC that returns pairs already joined with: decided flag, ownership, entitlement, song filter metadata, playlist `match_filters`.
  - The pure `deriveVisibleSuggestions` / `VisibilityPolicy` stay unchanged. Every caller, including `getSongSuggestions`, goes through the loader.
- **Deleted:** the private `fetchOwnedPlaylistIds`, the per-caller `Promise.all` fan-outs, and the chunked readers in `filter-metadata-queries.ts`.
- **Change type:** structural for the deck. A behavior change for liked-songs suggestions, which start honoring filters (confirm that is intended).
- **Size:** L (6 files + migration).
- **Openspec:** yes, because it changes matching read semantics. No overlap with active changes.
- **Verdict:** CONFIRMED.

### 4. Errors that never reach Sentry

- **Areas:** 3, 9
- **Files:**
  - `src/server.ts:81`, `src/worker/instrument.ts:38`, `src/lib/observability/sentry.client.ts:68`
  - `src/lib/server/playlists.functions.ts:925-939`
  - `src/lib/workflows/enrichment-pipeline/stage-accounting.ts:34-39`, `stage-outcomes.ts:245-264`
  - `src/lib/workflows/playlist-studio/publish.ts:143-162`
  - `src/lib/workflows/extension-sync/runner.ts:508-513,570-626`
- **Today:**
  - All three Sentry inits set `enableLogs: false`. `console.*` and `log.*` therefore never reach Sentry; only explicit `captureServerError` / `captureException` calls do. The code says so in a dozen comments.
  - Despite that, these failures are console-only:
    - A failed `applyLibraryProcessingChange` in `flushPlaylistManagementSession`. The sibling path at `:424` does capture.
    - A *throwing* enrichment stage (a code bug, not a provider error). It is `console.error`'d, then recorded per song as `PROVIDER_TRANSIENT`. No file under `enrichment-pipeline/` imports Sentry.
    - `publish.ts`: when the song or ownership lookup fails, it returns `trackUris: []`. The user gets an empty playlist and Sentry gets nothing.
  - Errors are also swallowed outright:
    - `applyUserProfile` destructures `{ data }` from both account reads and never looks at `error`. If the `currentAccount` read fails, the "payload spotify_id does not match linked account" guard is skipped and the sync proceeds. The `spotify_id` UNIQUE constraint backstops the conflict check, but nothing backstops the mismatch check.
    - `getTargetIds` turns a DB error into an empty set. The runner's own comment (`:526-530`) calls under-reporting target changes unsafe.
  - The pipeline throws about 27 `new Error(\`…${x.error.message}\`)` without `{ cause }`. That flattens TaggedErrors before `captureWorkerJobFailure`, so the `_tag`/`code` promotion in `capture-server-error.ts` never happens.
- **Proposed shape:** one rule, written into the boundary doc: "operational lines → `log.*`; any error you swallow, degrade, or convert → `captureServerError` (or the worker capture); Result→throw keeps `{ cause }`".
  - Fix the swallow sites above.
  - `applyUserProfile` goes through `fromSupabaseMaybe/Single` and fails the sync on a read error.
  - The console→`log` sweep (113 sites) is a separate, structural commit.
- **Deleted:** nothing significant. The fix adds captures.
- **Change type:** behavior change. Observability, plus `applyUserProfile` failing closed.
- **Size:** S for the swallow sites; M for the console sweep.
- **Openspec:** no. `telemetry-observability` covers product events, not error logging.
- **Verdict:** CONFIRMED.

### 5. Library-processing probes pass unbounded DB-derived id lists through `.in()`

- **Areas:** 2
- **Files:**
  - `src/lib/workflows/library-processing/scheduler.ts:146-200` (`deriveNeedsTargetSongEnrichment`)
  - `src/lib/workflows/library-processing/queries.ts:95-135` (`findTerminalActiveRefs`, used by `terminal-recovery.ts`)
  - `src/lib/workflows/playlist-sync/lightweight-enrichment.ts:66-150`
- **Today:**
  - **Scheduler.** It collects every song in every target playlist, then runs one *unchunked* `.in("song_id", [...targetSongIds])` against `liked_song`, and treats `if (error) return false` as "no target enrichment needed". About 200 UUIDs exceed the 8,000-character URL guard (`data/client.ts`) or a prod 414. A user with large target playlists therefore silently skips the snapshot refresh's target-song enrichment stage.
  - **Terminal-recovery sweep.** It reads every `library_processing_state` row with an active job across *all accounts*, then runs one unchunked `.from("job").in("id", [...jobIds])`. The URL grows with the number of active users.
  - **Lightweight enrichment.** It re-implements the scheduler's query with a hand-rolled chunk loop and a dynamic `await import("@/lib/data/client")`.
- **Proposed shape:**
  - One RPC, `select_target_only_song_ids(p_account_id, p_playlist_ids uuid[] default null)`, wrapped in `domains/library/playlists/queries.ts`. The scheduler asks for existence; lightweight enrichment asks for the rows.
  - Terminal recovery becomes one join, filtered to `status in ('completed','failed')`.
- **Deleted:** both playlist fan-out loops, three `.in()` legs, and the dynamic import.
- **Change type:** behavior change (bug fix at scale).
- **Size:** M (3 files + migration).
- **Openspec:** no.
- **Verdict:** CONFIRMED.

### 6. The entitlement predicate lives in the enrichment workflow, throws, and is re-fed through `.in()`

- **Areas:** 2, 3, 4
- **Files:**
  - `src/lib/workflows/enrichment-pipeline/batch.ts:29-53` (`getEntitledDataEnrichedSongIds`)
  - `src/lib/server/playlists.functions.ts:974-1003` (`getPlaylistMatchFilterOptions`)
  - `src/lib/domains/library/liked-songs/filter-options-queries.ts:34-188`
  - `src/lib/workflows/match-snapshot-refresh/stages/candidate-loading.ts`
  - `src/lib/workflows/enrichment-pipeline/stages/content-activation.ts:17-90`
  - `supabase/config.toml:18`
- **Today:**
  - The billing entitlement read ("which liked songs may this account see matched") is a throwing helper inside one workflow. It serves another workflow and a server fn, each of which wraps it in try/catch.
  - `getPlaylistMatchFilterOptions` materialises the account's whole entitled set, then passes it into three chunked `.in()` aggregate readers whose only caller is that server fn. It also does about 80 lines of language counting and merging in the handler.
  - The enrichment `content-activation` stage reads `account_billing` directly, next to an imported `readBillingState`, and calls billing RPCs (`activate_unlimited_songs`, `insert_song_unlocks_without_charge`). The second is also called from `domains/billing/unlocks.ts`.
  - The local PostgREST config sets `max_rows = 1000`. Full-set RPC reads (the entitled set, `getPlaylistSongs`, `getMatchResults`) truncate silently above 1,000 rows. That truncation would hit candidate sets, filter-option counts and the sync diff.
- **Proposed shape:**
  - `domains/billing/` owns the entitlement read and returns `Result`.
  - The filter options become one aggregate RPC over the entitled set. The language merge becomes a pure function in `match-filters/languages.ts`.
  - `content-activation` calls a billing-domain activation function instead of touching billing tables.
  - Full-set reads either paginate (as `candidate-loader.ts` already does) or aggregate in SQL.
- **Deleted:** the three chunked aggregate readers, the server fn's try/catch, and the inline billing table reads in the workflow.
- **Change type:** structural. It becomes a bug fix if prod PostgREST also caps rows.
- **Size:** M (5 files + migration).
- **Openspec:** no. It is adjacent to `replace-http-billing-bridge-with-db-outbox` but does not overlap it.
- **Verdict:** CONFIRMED for ownership and the `.in()` re-entry. **PLAUSIBLE** for the max_rows truncation: check `PGRST_DB_MAX_ROWS` on the self-hosted PostgREST via the `supabase-prod` skill.

### 7. `library_processing_state` is a blind read-modify-write from two runtimes

- **Areas:** 7
- **Files:**
  - `src/lib/workflows/library-processing/service.ts:46-126`
  - `src/lib/workflows/library-processing/queries.ts:157-180` (`persistLibraryProcessingState`)
  - `src/lib/workflows/library-processing/settlement.ts:89-120`
- **Today:**
  - `applyLibraryProcessingChange` loads the row, reconciles in memory, then writes all six watermark and active-job columns with only `.eq("account_id", …)`. There is no check against what it loaded.
  - It runs from Cloudflare server fns (playlists ×5, enrichment, billing) and from the Bun worker (runner, extension sync, recovery, backfill wake). Settlement writes the same columns in raw SQL.
  - Example race: a request loads state with active=J. The worker then settles J and clears it. The request's persist writes active=J back and regresses `settled_at`. The reconciler then believes a refresh is already active and skips ensuring one.
  - `recoverTerminalLibraryProcessingRefs` (sweep tick) or idle recovery eventually repairs it. Partial unique indexes on `job` prevent duplicate jobs. So the cost is late or lost work, not corruption.
- **Proposed shape:** one writer with a fence. Either:
  - optimistic CAS on `updated_at` (the trigger exists), re-loading and re-reconciling on a miss; or
  - per-account serialization through an RPC holding an advisory lock.

  Settlement writes through the same fence.
- **Deleted:** the unfenced update path.
- **Change type:** behavior change (concurrency).
- **Size:** M.
- **Openspec:** coordinate with `replace-http-billing-bridge-with-db-outbox`, which changes how billing changes enter library-processing. No conflict.
- **Verdict:** CONFIRMED that the write is unfenced. **PLAUSIBLE** on impact, because the sweeps mask it.

### 8. Matching knowledge is scattered across enrichment, embeddings and a fake service

- **Areas:** 1, 5, 11
- **Files:**
  - `src/lib/workflows/enrichment-pipeline/match-ranking.ts` (689 lines), `reranking.ts`, `stages/matching.ts`
  - `src/lib/domains/taste/song-matching/cache.ts:22-26`, `service.ts:118-480`
  - `src/lib/domains/enrichment/embeddings/hashing.ts:128-238`
  - `src/lib/workflows/match-snapshot-refresh/stages/{candidate-loading,matching,ranking}.ts`, `orchestrator.ts:407-421`
  - `src/lib/domains/playlists/draft-engine.ts:203`
- **Today:**
  - **`match-ranking.ts`.** The enrichment orchestrator never imports it. Its importers are the snapshot-refresh ranking stage and `domains/taste/song-matching/cache.ts`, which makes that the only non-billing domain→workflow edge.
  - **`stages/matching.ts`.** Not an enrichment stage. It is one RPC (`loadExclusionSet`) that *throws*, and its only caller rebuilds a Result with `.catch(err => err)` plus `instanceof` checks. A second `stages/matching.ts` exists under `match-snapshot-refresh`.
  - **`reranking.ts`** (`rerankMatches`). No production importer, only `scripts/matching-lab/*` and its own test. Its header ("used by both the normal enrichment pipeline and the rematch path") is false.
  - **Snapshot hashers.** Seven match-snapshot hash functions in `embeddings/hashing.ts` each have exactly one caller: `cache.ts`, a file named "cache" that computes snapshot identity.
  - **`MatchingService`.**
    - Its constructor takes `_embeddingService` and `_profilingService` and ignores both.
    - The file contains zero `await`s and no `Result.err`, yet `matchBatch` is `async` and returns `Result<…, MatchingError>`. So the orchestrator's "Matching failed" throw (`orchestrator.ts:416-421`) and draft-engine's degraded-ranking fallback are unreachable.
    - The `onProgress` option has no caller that passes it.
- **Proposed shape:**
  - `match-ranking.ts` → `domains/taste/song-matching/ranking.ts`. Its interface is already pure, with an injected `RerankerService`.
  - `loadExclusionSet` → `song-matching/decision-queries.ts`, returning `Result`.
  - The seven hashers plus `computeMatchSnapshotMetadata` → `song-matching/snapshot-identity.ts`, exposing one `computeSnapshotIdentity()` that returns the four hashes callers actually read.
  - `MatchingService` → a plain `matchBatch(songs, profiles, embeddings, { exclusionSet, config })`.
  - `reranking.ts` and its test → `scripts/matching-lab/`.
  - Second commit: fold `match-snapshot-refresh/stages/matching.ts` (two lines after this change) into the orchestrator.
- **Deleted:**
  - `enrichment-pipeline/{match-ranking,reranking,stages/matching}.ts` from enrichment
  - the `MatchingService` class and `createMatchingService`
  - the two dead constructor params (and `runScoring`'s pass-through of them)
  - `onProgress` / `cached`
  - the two unreachable error branches
  - `cache.ts`
- **Change type:** structural. Removed branches are unreachable.
- **Size:** M (~10 files + tests).
- **Openspec:** `openspec/specs/lib-module-topology/spec.md` says enrichment-pipeline coordinates "…profiling, and matching". It needs a one-line delta to match the glossary.
- **Verdict:** CONFIRMED.

### 9. Billing orchestration is filed as domain code

- **Areas:** 1, 2
- **Files:**
  - `src/lib/domains/billing/unlocks.ts:16-17`, `liked-song-access-grant.ts:16-17`, `bridge-handlers.ts:3-5`, `unlimited-subscription-gift.ts`
  - `src/lib/domains/enrichment/audio-feature-backfill/wake.ts:12-13`
  - `src/lib/domains/library/accounts/onboarding-allocation.ts`
  - `src/lib/workflows/library-processing/scheduler.ts:3`
- **Today:**
  - Each of these domain modules runs an RPC mutation and then calls `applyLibraryProcessingChange(BillingChanges.…)`. That is cross-domain orchestration, so these are workflows.
  - The folder-level dependency is circular: billing → library-processing → `domains/billing/queries`.
  - `billing.functions.ts` even aliases one import: `requestSongUnlock as orchestrateUnlock`.
- **Proposed shape:**
  - Move the orchestration functions (unlock, liked-song access grant, unlimited gift, backfill wake) to `workflows/billing/` and `workflows/audio-feature-backfill/`.
  - RPC wrappers and payload parsers stay in `domains/billing` as queries.
  - Keep the fan-out inside the moved functions. "Unlock committed ⇒ library-processing told" is the invariant, and it has 6+ callers.
  - Control-panel imports (`operations.ts`, `batch-adapters.ts`, 4× `wake`) move with them.
- **Deleted / renamed:** nothing is deleted. 4–6 files move; ~10 importers change.
- **Change type:** structural.
- **Size:** M.
- **Openspec:** exclude `bridge-handlers.ts` and `routes/api/billing-bridge.ts`, which `replace-http-billing-bridge-with-db-outbox` replaces. Its new consumer should land in `workflows/`, not `domains/`.
- **Verdict:** CONFIRMED.

### 10. Worker host code lives in `src/lib`, the worker imports a server-fn module, and a failed settle re-runs a finished job

- **Areas:** 1, 3, 5
- **Files:**
  - `src/lib/workflows/library-processing/runner.ts:1,13-20,118-140,236-256`
  - `src/worker/poll.ts:5`
  - `src/worker/account-events-gateway.ts:13`
  - `src/lib/server/jobs.functions.ts`
  - `src/lib/account-events/contract.ts:15`
- **Today:**
  - **`runner.ts`.** It imports `@sentry/bun`, `@/worker/execute`, `@/worker/job-failure-reporting` and `@/worker/posthog-capture`. Its only caller is `worker/poll.ts`, which makes a worker → lib → worker loop. It writes out the same settlement sequence four times.
  - **Settle failure.** When the "mark completed" settle fails, the runner does `throw new Error(completedResult.error.message)` inside its own try. The catch sends the job, whose work already executed, to `tryRequeueForRetry`.
  - **`account-events-gateway.ts`.** It imports `buildActiveJobsSnapshot` from `jobs.functions.ts`, which loads `createServerFn` and `authMiddleware` (and through them Better Auth) into the Bun worker.
  - **The SSE wire contract** imports its `ActiveJobs` type from that same server-fn file.
- **Proposed shape:**
  - `runner.ts` → `src/worker/`, with a pure `planSettlement(workflow, executeResult)` and one `applySettlement`.
  - `ActiveJobs` types + `buildActiveJobsSnapshot` → `platform/jobs/active-jobs.ts`. `jobs.functions.ts` shrinks to the server fn.
  - Decide explicitly whether a settle failure should requeue. Today the requeue is an accident of the throw.
- **Deleted:** three copies of the settlement sequence, and `src/lib`'s only `@/worker` imports.
- **Change type:** structural. The requeue decision is a behavior change if it changes.
- **Size:** S–M (~5 files).
- **Openspec:** no.
- **Verdict:** CONFIRMED.

### 11. The match-deck read model lives at the server-fn boundary

- **Areas:** 4, 5
- **Files:**
  - `src/lib/server/match-deck.functions.ts:71-867`
  - `src/lib/server/match-deck-miss-path.ts`
  - `src/lib/server/match-review-queue.functions.ts:27-200`
  - `src/lib/server/matching.functions.ts`
- **Today:**
  - About 870 of `match-deck.functions.ts`'s 1,048 lines are not server-fn bodies:
    - public view types and pure mappers (`mapReadDeckCardToItemRead`, `mapStartOrResumeToView`)
    - the 140-line `resolveMatchDeckView` (hash → probe → miss → snapshot check → promote)
    - the card cold path
    - raw `match_review_queue_item` reads
  - The same owned-item read appears again in `match-review-queue.functions.ts:129-142`.
  - `match-deck-miss-path.ts` returns `Result`, defines no server fn, and is pure domain orchestration living in `lib/server`.
  - `resolveMatchDeckView(accountId, orientation, emitEntryMetrics = false, options?: { skipHashComputation })` has exactly two callers. They always pass the two flags opposite to each other (`true` / – and `false` / `true`): one mode encoded as two booleans.
  - Server files import each other for domain types: `match-deck` → `match-review-queue.functions` → `matching.functions`.
  - The header at `:14-16` ("ships alongside the legacy query families") is stale.
- **Proposed shape:**
  - `domains/taste/match-review-queue/deck-view.ts`: view types and pure mappers.
  - `deck-entry.ts`: `resolveMatchDeckView` + miss path + cold path, returning `Result<{ view, entry: "active" | "promoted" | "no_snapshot" | "promotion_incomplete" }, DbError>`. The server fn emits hit/miss metrics from `entry`, so both booleans disappear.
  - One `getOwnedQueueItem` in `queries.ts`.
  - The server-fn file shrinks to about 150 lines: schemas, auth, Result→throw, product events. This passes the deletion test because a two-argument interface hides a long flow.
- **Deleted:** `match-deck-miss-path.ts` (folded in), three inline item reads, the duplicate `OrientationSchema`, and the stale header.
- **Change type:** structural. Keep the miss-path race comments; they carry weight.
- **Size:** M.
- **Openspec:** no.
- **Verdict:** CONFIRMED.

### 12. Proposal-rebuild scheduling lives in three places, outside library-processing

- **Areas:** 4, 7, 11
- **Files:**
  - `src/lib/server/playlists.functions.ts:89-154,782-829,913-949`
  - `src/worker/execute.ts:236-277`
  - `src/lib/server/match-deck-miss-path.ts:128-140`
  - `src/lib/workflows/library-processing/reconciler.ts:180-191`, `changes.ts:8`, `types.ts:76`
- **Today:**
  - Three sites build the same idempotency key, `build:${accountId}:${orientation}:${snapshotId}:${hash}`, and two of them repeat the same per-orientation hash-then-enqueue loop.
  - The routing decision (scoring change → snapshot refresh; filter-only → proposal rebuild) is written twice inside `playlists.functions.ts`.
  - `PlaylistManagementChanges.sessionFlushed` carries `readTimeFilterChanged`, but the reconciler never reads it.
  - The reconciler comment says filter changes are "handled by syncing active sessions", a path that no longer exists.
  - The glossary makes library-processing the place that decides "what work to schedule after any library change". For filter edits, it doesn't.
- **Proposed shape:**
  - Step 1 (structural): `enqueueProposalRebuild(accountId, snapshotId)` with a single key builder in `match-review-queue/deck-jobs.ts`, used by all three sites. Fix the reconciler comment.
  - Step 2 (decision): either make filter-only flushes a reconciler effect, or delete `readTimeFilterChanged` from the change type.
- **Deleted:** two loop copies and two key-format copies, plus either the dead field or the server-side routing.
- **Change type:** step 1 structural; step 2 moves policy.
- **Size:** S (step 1), M (step 2).
- **Openspec:** step 2 changes the `library-processing` spec, so it needs a short change.
- **Verdict:** CONFIRMED.

### 13. Match filters are validated by two schemas; the edge copy is weaker, and the workflow re-parses

- **Areas:** 4 (parse-once)
- **Files:**
  - `src/lib/server/playlist-draft.functions.ts:46-78`
  - `src/lib/domains/taste/match-filters/schemas.ts:15-135`
  - `src/lib/workflows/playlist-studio/publish.ts:124`
  - `src/lib/server/playlists.functions.ts:687-707,756`
- **Today:**
  - `playlist-draft.functions.ts` hand-copies `MatchFiltersV1Schema`. The copy drops several rules the domain schema enforces:
    - year bounds
    - the real-calendar-date refine
    - the language-catalog / non-empty check
    - range-ordering refines
    - nested `.strict()`
  - That weaker copy guards three server fns: preview, persist new config, record studio actions.
  - `runPersistNewPlaylistConfig` receives already-typed filters and re-runs `parseSaveMatchFilters`. That is the only parse-once violation in domains or workflows.
  - `savePlaylistMatchConfig` validates `matchFilters: z.unknown()` and parses inside the handler, which forces a hand-written input type.
- **Proposed shape:** export the strict save schema from `match-filters/schemas.ts` and put it directly in all four `inputValidator`s.
- **Deleted:** the edge copy, both downstream `parseSaveMatchFilters` calls, and the hand-written input type.
- **Change type:** behavior change. Preview and studio-action edges start rejecting filters the domain already considers invalid.
- **Size:** S.
- **Openspec:** no.
- **Verdict:** CONFIRMED.

### 14. Dead code, some of it pinned by tests

- **Areas:** 4, 5, 7, 10
- **Files and evidence:** each item was checked by grepping `src/`, `scripts/` and `control-panel/`.
  - **`src/lib/server/match-review-queue.read.ts`** (212 lines): imported only by `server/__tests__/song-orientation.test.ts`.
  - **`playlists.functions.ts`:** `savePlaylistGenrePills` (:496-578) and `savePlaylistMatchIntent` (:584-685). Only Ladle stubs and tests reference them.
  - **`onboarding.functions.ts`:** `executeSync` (a no-op "kept for type compatibility"), `saveDemoSongSelection` and `getLibrarySummary`. Only stubs and tests reference them.
  - **`matching.functions.ts:164-269`:** `getMatchSnapshotData`, `getUndecidedSongs` and `deriveUndecidedSongs`. Only `matching.functions.strictness.test.ts` references them; the live derivation is in `match-review-queue/service.ts`.
  - **`match-review-queue/queries.ts`:** `insertMatchReviewSession` (:162), `completeSession` (:222), `countCapturedVisiblePairs` (:698), `insertSessionSnapshot` (:931). Zero non-test references.
    - Consequence: `match_review_session.status` is only ever written as `'active'`.
  - **`ActiveJobs.firstMatchReady`** (`jobs.functions.ts:33-35`): "kept for backward-compatibility". Only stories and tests read it.
  - **Query keys:** `features/matching/queries.ts:14-16` defines `matchReviewKeys.review` and `reviewsRoot`, but no query registers those keys. So the invalidations at `SettingsPage.tsx:150` and `PlaylistsCoverFlowScreen.tsx:204` do nothing. The comment above the latter (`:192-199`) still describes "filter-only → active-queue sync".
  - **`enrichment-pipeline/reranking.ts`:** see #8.
  - **Prompt versions:** `content-analysis/prompts/lyrical-v17-regrouped`, `v19…v30` (~1,100 lines). `ACTIVE_LYRICAL_VERSION` has been `"17"` since `23f66ea9`; only `scripts/voice-audit/*` selects other versions.
- **Proposed shape:**
  - Delete the dead code.
  - Move the prompt variants and a script-side registry to `scripts/voice-audit/prompts/`.
  - Drop the stale mocks that reference deleted exports.
- **Deleted:** ~1,900 lines in total.
- **Change type:** structural. The tests that exist only to pin dead code (`song-orientation.test.ts`, `matching.functions.strictness.test.ts`, and the `savePlaylistGenrePills` / `savePlaylistMatchIntent` cases) go with it. That removes coverage of deleted code; it does not weaken a test. Still, approve it explicitly, given the CLAUDE.md test rules.
- **Size:** S.
- **Openspec:** no. Dead SQL functions (`claim_pending_rematch_job`, `sweep_stale_rematch_jobs`, `mark_dead_rematch_jobs`, `claim_pending_lightweight_enrichment_job`, `mark_stale_extension_sync_jobs`) are listed by the state-machine sub-audit. Dropping them is destructive DDL, so it goes on the manual path in `docs/ops/prod-db-migrations.md`. Not independently re-verified.
- **Verdict:** CONFIRMED for every TS item.

### 15. Untyped seams: stored analysis JSON, deck RPC payloads, deck-job payloads, orientation

- **Areas:** 8
- **Files:**
  - `src/lib/server/liked-songs.functions.ts:95`, `src/lib/server/onboarding-session.ts:194`
  - `src/lib/domains/enrichment/content-analysis/analysis-content.ts`
  - `song-detail-adapter.ts:37-40`
  - `src/lib/domains/taste/match-review-queue/deck-read-queries.ts:212,250`, `deck-jobs.ts:234-264`
  - `src/worker/poll-match-deck-jobs.ts:57-67,166`
- **Today:**
  - **Stored analysis.** Both server fns cast `song_analysis.analysis` to `AnalysisContent`, an all-optional legacy shape (headline / themes / journey / key_lines). The column actually holds `SongRead` or the instrumental read. The client adapter then re-parses with two `safeParse` calls, so parsing happens downstream of the edge.
  - **Deck read RPCs.** `start_or_resume_match_deck` and `read_match_deck_card` return `Json` and are cast `as unknown as …RpcResult`; only `status` is checked. This is the main product surface.
  - **Deck-job payloads.** They are written as `{ snapshotId } as Json` from four sites and decoded with a hand-written `payloadSnapshotId`, which fails at runtime if the field is missing.
  - **Orientation.** "song | playlist" is defined about ten times. There are three Zod enums, three hand-written narrowers (one of which throws inside a `Result` function), `MatchViewMode` in features, and `EnqueueDeckJobInput.orientation: string`.
  - **Few true seam casts.** Only 2 production `as any` (both in `providers/adapters/local.ts`) and ~14 real `as unknown as`. The four seams above are the ones that matter.
- **Proposed shape:**
  - Parse stored analysis once, server-side, into `AnalysisRead = { kind: "lyrical"; read } | { kind: "instrumental"; read } | { kind: "none" }`. This pairs with #2's schema move.
  - Decode deck RPC returns through the existing `fromSupabaseRpc(schema, …)`, which today has one caller.
  - Add a `DeckJobSpec` union keyed by `kind`, decoded once at claim.
  - Keep one `MatchOrientationSchema` + type in `match-review-queue/types.ts`.
- **Deleted:** `AnalysisContent`, the adapter's double parse, `payloadSnapshotId`, about six orientation definitions, and the `as Json` casts.
- **Change type:** structural. The payload shape to the client changes.
- **Size:** M.
- **Openspec:** no.
- **Verdict:** CONFIRMED.

### 16. Client cache invalidation is owned by `lib/hooks` but defined in features

- **Areas:** 10, 1
- **Files:**
  - `src/lib/hooks/useAccountEvents.ts:3-6,252`, `src/lib/hooks/useActiveJobs.ts:3`
  - `src/features/billing/hooks/usePostPurchaseReturn.ts:48-67`, `src/features/liked-songs/hooks/useSongUnlock.ts:64-68`
  - `src/routes/_authenticated/route.tsx:108-111`, `routes/_authenticated/checkout/success.tsx:61-64`
  - `src/features/onboarding/components/PlanSelectionStep.tsx:84`
  - `src/features/onboarding/components/ClaimHandleStep.tsx:128-132,445-495`
  - `song-detail-types.ts:40-59`
- **Today:**
  - **Upward imports.** `lib/hooks` imports runtime key factories from four features (billing, dashboard, liked-songs, matching). These are four of the five `src/lib` → features imports.
  - **"Entitlement changed" invalidations are written three times, and the copies differ:**
    - `usePostPurchaseReturn` (twice) and `useSongUnlock` invalidate billing state, liked songs and dashboard.
    - The SSE `billing_state_changed` handler invalidates only `billingKeys.state`.
  - **The billing-state query** (`{ queryKey: billingKeys.state, queryFn: getBillingState }`) is declared by hand three times with different `staleTime`s. There is no `billingStateQueryOptions`.
  - **Two client-state union candidates:**
    - **`ClaimHandleStep`.** `isSubmitting` and `submitInFlight` are set and cleared together at all four sites.
    - **`SongDetail`.** It carries `read | null`, `instrumentalRead | null` (whose own comment says "mutually exclusive with `read`"), optional `displayState` and optional `contentFetchStatus`. `SongDetailPanelSurface` resolves them with a nested ternary.
- **Proposed shape:**
  - A dependency-free key module below features (`src/lib/query-keys.ts`) plus named invalidation sets: `invalidateEntitlementQueries`, `invalidateMatchSnapshotQueries`. This earns its place: 3+ call sites, and `lib/hooks` needs it.
  - Each feature's `queries.ts` exports `xQueryOptions`; callers spread them and override `staleTime`.
  - `ClaimHandleStep` keeps one flag.
  - `SongDetail.content` becomes `{ kind: "lyrical" | "instrumental" | "locked" | "analyzing" | "unavailable", … }`, rendered with one exhaustive switch.
- **Deleted:** three duplicate invalidation blocks, two hand-declared billing queries, one `useState`, and four optional `SongDetail` fields.
- **Change type:** structural. Making the SSE path invalidate the same set as the hooks is a behavior change; do it as its own commit.
- **Size:** M.
- **Openspec:** no.
- **Verdict:** CONFIRMED.

### 17. Placement sweep: modules filed in the wrong layer

- **Areas:** 11, 1, 4
- **Each item is structural, XS–S, and independently committable:**
  - **`src/lib/integrations/audio/service.ts`.** It "orchestrates fetching and persisting audio features", imports `domains/enrichment/audio-features/queries`, and has three workflow callers. → `domains/enrichment/audio-features/service.ts`. This deletes one of the two integration→domain edges.
  - **`src/lib/email/waitlist-confirmation.ts`.** It builds its own `new Resend(…)` with its own FROM constants and ignores the send result. `platform/email/resend-client.ts` already does this with error logging. → `platform/email/send-waitlist-confirmation.ts` on `sendEmail`. Delete `src/lib/email/`. `add-account-deletion` adds its sender under `platform/email`, which is consistent.
  - **Utils folders.**
    - `src/lib/utils/{color,palette}.ts` → `lib/theme/`.
    - `src/lib/utils/slug.ts` → `domains/library/songs/`.
    - `src/utils/posthog-server.ts` → `lib/observability/`.
    - Delete both folders.
    - Fix `components.json`: `"utils": "@/lib/utils"` has no `cn` (it lives in `lib/shared/utils/utils.ts`), and `"hooks": "@/hooks"` doesn't exist. Any `shadcn add` currently generates broken imports.
  - **`features/onboarding/checkout-intent.ts`.** Stripe-redirect persistence, imported by three billing files and both checkout routes, while onboarding imports billing. → `features/billing/checkout-intent.ts`.
  - **`src/lib/extension/transport.ts:19`.** It imports `ExtensionWireMessage` from `../../../extensions/src/shared/types`, i.e. the app reaches into extension internals. → top-level `shared/`, next to `extension-bridge-protocol.ts`.
  - **Extension route auth.** `lib/server/extension-auth.ts` (`resolveExtensionAccountId`) is copied inline, byte-identical, in `routes/api/extension/sync.tsx:84-98` and `artists/check.tsx:16-37`. Use the helper. `status.tsx` is deliberately different and stays.
  - **`features/playlists/create/intentEligibility.ts`.** It defines a `createServerFn` that imports the admin Supabase client. → `lib/server/billing.functions.ts`, with its `queryOptions` in `features/playlists/queries.ts`.
  - **Leaked DB error text.** Seven server-fn throws interpolate the DB error message into client-visible text and drop `cause`: `playlists.functions.ts:180,384,485,545,637,778` and `liked-songs.functions.ts:186`. Use static messages with `{ cause }`, per the `public-handle.functions.ts` exemplar.
- **Verdict:** CONFIRMED for every item.

### 18. Folder names that contradict the glossary

- **Areas:** 11, 12
- **Files:** `src/lib/domains/taste/`, `src/lib/domains/playlists/`, `CLAUDE.md` glossary, `docs/architecture/matching/*.md`, `openspec/specs/lib-module-topology/spec.md`.
- **Today:**
  - **`domains/taste`** holds `song-matching`, `match-review-queue`, `match-filters`, `playlist-profiling` and `genre-similarity`, all of which the glossary calls **matching**. The only product use of "taste" (the playlist-creation taste profile) lives *outside* this folder, in `domains/library/liked-songs/taste-profile-queries.ts`.
  - **`domains/playlists`** is the playlist-studio draft engine. It sits next to `domains/library/playlists`, which holds playlist persistence. The same concept is called "studio", "draft" and "create" in different layers.
  - **The glossary says "job = the `job` table".** There are three job tables, each with its own poller: `job`, `match_review_deck_job` and `audio_feature_backfill_job`.
  - **"Deck"** is in neither glossary.
  - **`docs/architecture/matching/architecture.md`** still describes `createOrResumeQueue` / `appendSnapshotDelta` / `startOrResumeMatchReview`. None of these exist in `src/`.
- **Proposed shape:**
  - `domains/taste` → `domains/matching`. This is a codemod of ~250 import lines in ~112 files plus scripts and docs. Do it after #8.
  - `domains/playlists` → `domains/playlist-studio` (18 importers).
  - Glossary additions: snapshot, proposal, review session, deck card, and the three job queues.
  - Rewrite matching `architecture.md` §2/§6/§9 against the current code.
- **Change type:** structural; mechanical commits.
- **Size:** M (high churn, low risk).
- **Openspec:** yes. `lib-module-topology` names `domains/taste/*`.
- **Verdict:** CONFIRMED. Leverage is lower than the churn suggests, so it is ranked last.

---

## Status-column writer map (Area 7)

Mapped by the state-machine sub-audit. Rows with a finding were verified directly; the `job`, deck-job, backfill and settlement fences were spot-checked.

| Column | Writers | CAS? | Verdict |
|---|---|---|---|
| `job.status` | `platform/jobs/repository.ts`, `library-processing-queue.ts`, `workflows/library-processing/settlement.ts` (raw SQL); SQL claim/sweep/dead fns; `begin_extension_sync` | Yes. Fenced on `status` + `attempts` (no `locked_by` column) | Sound. Writers span 3 TS modules: `settlement.ts` re-implements `markClaimedJobTerminal` in a transaction. Moving tx-taking transitions into `platform/jobs/` would give one owner |
| `match_review_deck_job.status` | `deck-jobs.ts`; claim/sweep SQL (`20260929100000` claim token) | Yes. `status` + per-claim `locked_by` token | Exemplary |
| `audio_feature_backfill_job.status` | SQL family; `control-panel/server/audio-feature-reviews.ts` | Yes, but `locked_by` = `audio-backfill-${hostname}-${pid}` (`poll-audio-feature-backfill.ts:29`) | Can't tell two claims by the same process apart. Safe only at concurrency 1. Switch to a per-claim token like deck jobs |
| `match_review_session.status` | SQL only (`start_or_resume_match_deck` inserts `'active'`). The TS writers are dead (#14) | n/a | `completed`/`abandoned` are unreachable. Intended, or a missing transition? |
| `match_review_proposal.status` | `proposal-builder.ts` (worker job **and** request-path miss handler) | **No.** The final `ready`/`stale` write is `.eq("id")` only (`:331-338`) | PLAUSIBLE race: a newer snapshot's stale sweep can be overwritten by an older build's blind `ready`. The five-call build is not one transaction; `failed` is never written. Candidate: one write-phase RPC |
| `match_review_queue_item.state` | SQL action RPCs | Yes (`FOR UPDATE` + state check) | OK |
| `user_preferences.onboarding_step` / `onboarding_completed_at` | `preferences-queries.ts` ×2, `onboarding.functions.ts` | Mixed | **#1** |
| `library_processing_state.*` | `workflows/library-processing/queries.ts`, `settlement.ts` | **No** | **#7** |
| `account_billing.subscription_status` | `activate_/deactivate_/update_subscription_state` SQL; gift path | Monotonic event-time fence | OK |
| `billing_bridge_event.status` | claim/finalize SQL via `routes/api/billing-bridge.ts` | Yes (token + lease) | OK. Superseded by the outbox openspec |
| `job_item_failure.resolved_at` | `platform/jobs/item-failures.ts`; **also** `audio-feature-backfill/service.ts:351-358` | n/a | The second writer bypasses the owner, is not account-scoped, and never checks errors. Route it through `item-failures.ts` |

**Re-invocable handlers.**

- **Idempotent:**
  - **Job claims.** `FOR UPDATE SKIP LOCKED` + attempts fence.
  - **Extension-sync ingress.** `begin_extension_sync`: advisory lock, self-heal, cooldown, then enqueue.
  - **Deck jobs.** Partial-unique idempotency key + claim token.
  - **Billing bridge.** Claim-or-reclaim with token-fenced finalizers.
  - **SSE reconnect.** Outbox `publish_id` cursor; the client drops `id <= lastSeen`.
- **Not idempotent:** #1 (a stale step save undoes completion) and #7 (lost update).

## Rules worth enforcing mechanically

All current violations are listed in the findings above.

| # | Rule | Mechanism | Violations today |
|---|---|---|---|
| R1 | `lib/{domains,platform,integrations,shared,data,account-events}/**` must not import `@/lib/workflows/**`, `@/lib/server/**`, `@/worker/**`, `@/features/**`, `@/routes/**` | Biome `noRestrictedImports` override (the pattern already exists at `biome.json:97-123`) | 10 lines in domains (#8, #9); `platform/jobs/progress/match-snapshot-refresh.ts` → workflows; `account-events/contract.ts` → `lib/server` (#10) |
| R2 | `lib/integrations/**` must also not import `@/lib/domains/**`, `@/lib/platform/**` | Biome | 2 (#17) |
| R3 | `src/lib/**` must not import `@/features/**`, `@/routes/**`, `@/worker/**` | Biome | 5 files + `runner.ts` (#10, #16) |
| R4 | `src/worker/**`, `lib/workflows/**`, `lib/domains/**` must not import `@/lib/server/**` | Biome | 1 (#10) |
| R5 | `src/**` must not import `**/extensions/src/**` or `**/control-panel/**` | Biome | 1 (#17) |
| R6 | Client graph must not reach `src/env.ts`, `lib/data/client.ts`, `lib/workflows/**`, `lib/integrations/**`, `content-analysis/prompts/**`, `src/worker/**` | TanStack Start `importProtection.client.files` (runs after server-fn compilation, so type and handler-only imports pass) | 2 chains (#2) |
| R7 | Lint `shared/**` (today Biome only includes `**/src/**`) and forbid `@/**` from it | Biome `files.includes` + override | 0 |
| — | Feature → feature | Needs a back-reference rule (dependency-cruiser) or 14 Biome overrides. **Not yet worth it.** Revisit after #16/#17 with an allowlist (playback, `billing/components`, `playlists/components`, landing → *) | — |

Biome patterns cannot exempt `import type`. That is fine for R1–R5, because type-only upward edges are also worth removing, and it is why R6 uses `importProtection`.

## Open questions this audit surfaced (not findings)

- **`/checkout/success` with no stored intent.** It renders "purchase confirmed" without consulting billing state (`routes/_authenticated/checkout/success.tsx:57-114`: `intent === null` ⇒ `pending = false`, `timedOut = false`, so it falls through to the success view). Is that intended for direct visits?
- **Filter save and the deck.** After a filter save, `PlaylistsCoverFlowScreen` invalidates only dead keys (#14) and no deck keys. Does the deck refresh through the proposal-rebuild job + account event, or is there a stale-until-reload window?
- **`match_review_session.status`.** It is never anything but `'active'` (#14). Are deck sessions meant to be permanent?
- **PostgREST row cap.** Is `max_rows` / `PGRST_DB_MAX_ROWS` set on prod (#6)?

## Overlap with active openspec changes

| Change | Relation to this audit |
|---|---|
| `refactor-env-to-varlock` | Overlaps #2's env half. **Stale**: it targets files that no longer exist, predates `env.public.ts`, and ignores the worker (whose env reads are spread across `posthog-capture.ts`, `posthog-otel.ts`, `instrument.ts` and `account-events-gateway.ts`; the PostHog token fallback is copied twice). Archive or rewrite |
| `replace-http-billing-bridge-with-db-outbox` | Excluded from #9 (`bridge-handlers.ts`, the bridge route) and #7 (coordinate). Its consumer should live in `workflows/` |
| `add-lrclib-and-instrumental-detection` | `lyrics/service.ts` `resolveOutcome` tangles verdict precedence with fetch and retry, but sits inside this change's scope, so it is not listed. All tasks are checked; the change is not archived |
| `add-account-deletion` | Its new sender belongs in `platform/email` (consistent with #17). Its `deletion_requested_at` transitions should follow the one-writer + CAS rule (#1 shows the cost) |
| `telemetry-observability` | Product events only; no overlap with #4 |
| `clarify-ui-surface-layering` | Adjacent to `SongDetailPanelSurface`'s JS hover/press state (10 booleans driving inline styles); not listed |
| `exclude-accounts-from-product-metrics`, `add-authenticated-error-boundary` | No overlap |

## Deliberately not on the list

These look off but should stay.

- **`lib/integrations/providers/ports.ts` + `factory.ts`.** There are three real adapters (deepinfra, huggingface, local), selected by env. The interface has more than one implementation.
- **`enrichment-pipeline/stages/*`.** Each stage owns a distinct provider, its own failure classification and its own tests. This is not an execution-order split. By contrast, the `match-snapshot-refresh/stages/*` files are thin and fold in naturally after #8.
- **`failure-policy.ts` (pure) next to `record-failure.ts` (IO).** The right split, and Biome already guards the song-analysis side.
- **Naming.** "runner" vs "orchestrator" are different roles: runners own the claimed-job lifecycle; orchestrators sequence stages within one unit of work. Feature `queries.ts` (TanStack options) vs domain `queries.ts` (DB) splits cleanly by folder. A suffix convention isn't earned yet.
- **Matching placement.** `domains/billing` is right and the boundary doc is wrong. The deck code under `match-review-queue/` is also right: the deck is a read model of the review session.
- **`src/routes/api/**` importing domain queries and the data client.** It is the HTTP edge, a peer of `lib/server`.
- **Feature imports.**
  - 80 `import type` statements from features into domains: erased at build.
  - Most feature→feature imports are deliberate reuse:
    - `playback` is a shared single-active-playback coordinator (~15 imports).
    - matching reuses playlist Cover/TrackList.
    - landing demos reuse the real detail panel.
    - billing paywall components are shared.
  - `genre-options.ts` + the lastfm whitelist on the client: documented as intentional.
  - `theme/types.ts` importing DB `Constants`: a single source of truth.
- **Legitimate throws and try blocks.** Throws inside `Result.tryPromise` callbacks (lrclib, netease, lyrics). Prompt anchor assertions at module load. Impossible-state guards. `postgres.js sql.begin` try/catch wrappers. Extension-sync's gunzip / JSON / Zod job-boundary catch. `runStageWithAccounting` as the single stage catch point.
- **Separate `postgres()` connections.** Per-request in `auth-request-state.server.ts`, because Cloudflare Workers cannot share sockets across requests. The worker's LISTEN connections need to be dedicated.
- **Three PostHog server clients.** One per runtime, each justified. Only the duplicated env fallback should move.
- **Remaining casts.** `as any` in `routeTree.gen.ts`, the `src/__mocks__` stubs and story fixtures. `as unknown as Json` on jsonb RPC *params* is interface-vs-index-signature friction, with a Zod source upstream.
- **`begin_extension_sync` failing stale `running` parents** (a third `job.status` writer). It is gated on heartbeat age, and the parent's own settle is fenced.
- **Deck action RPCs** that `SELECT … FOR UPDATE` and then check state: equivalent to CAS.
- **`extension-sync/runner.ts` length.** It is one cohesive orchestration with an already-pure `classifyChange`. Only its error handling is listed (#4).
- **`library-processing/queries.ts` owning `library_processing_state`.** The reconciler owning its own state table is right; the doc should say so.
- **`visibility-config-hash.ts`, `match-snapshot-refresh/superseded.ts`.** Small, with several callers or their own test.
- **`SettingsPage`'s three saving flags.** They are genuinely independent and can co-occur.

## Deep modules worth imitating

- **`workflows/library-processing/reconciler.ts` + `changes.ts` + `service.ts`.** A pure `(state, change) → { state, effects }` behind one entry point, `applyLibraryProcessingChange(XChanges.y(…))`.
- **`platform/jobs/repository.ts` + `lifecycle.ts`.** Every job write is CAS. One `JobTransition = "applied" | "superseded"` vocabulary. `retryTransition` tells its own committed write apart from a competitor's.
- **`match-review-queue/deck-jobs.ts` + migration `20260929100000`.** A per-claim token fence, `release` that refunds the attempt under the same fence, and dedupe via partial-index `ON CONFLICT`.
- **Account-event outbox.** `writeAccountEvent(tx)` inside the domain transaction, one advisory-locked publisher, and a cursor that can't skip a later-committing event.
- **`begin_extension_sync`.** One RPC turns a racy read-then-create into lock → heal → gate → enqueue → notify.
- **`enrichment-pipeline/failure-policy.ts`.** Pure retry, backoff and escalation behind `applyFailurePolicy`.
- **`match-review-queue/visibility-policy.ts`.** Pure policy plus a deterministic hash, used by seven modules.
- **`domains/playlists/draft-engine.ts` + `candidate-loader.ts`.** A pure engine fed by an IO-only loader. The loader uses paginated FK embeds instead of `.in()`.
- **`platform/jobs/progress/parse.ts`.** One discriminated parse for a jsonb column.
- **`shared/utils/result-wrappers/supabase.ts`.** Three tiny functions that hide PostgREST error mapping.
- **`lib/data/client.ts`.** A dev-time URL-length guard makes the `.in()` rule fail loudly.
- **`observability/capture-server-error.ts`.** Promotes nested `_tag`/`code` to Sentry tags.
- **`playlist-draft.functions.ts` handlers and `public-handle.functions.ts`.** Three-line boundaries over a workflow.
- **`preferences-queries.completeOnboarding`.** A documented compare-and-set write. #1 is the step writer failing to match it.

---

## Proposed `module-boundaries.md` table

The current doc covers 7 of 19 `src/lib` folders. It omits `server`, `extension`, `account-events`, `observability`, `hooks`, `consent`, `keyboard`, `theme`, `navigation`, `config`, `email`, `utils`, as well as `src/routes`, `src/features`, `src/components`, `src/worker`, `src/integrations`, `src/utils`, top-level `shared/` and the env modules.

**Where the doc is wrong:**

- It places "billing infrastructure" under platform. The code has `domains/billing`, and the code is right.
- `openspec/specs/lib-module-topology/spec.md` is a second source of truth that also says matching belongs to enrichment-pipeline.

**Where the code is wrong against the doc:**

- Nine workflow files query tables directly.
- Two barrel-style re-exports: `match-review-queue/readiness.ts` re-exports from `./service`, and `match-ranking.ts` re-exports `MatchOrientation`.
- The import violations in R1–R5.

The table below assumes #8–#10 and #17 land. "Today" columns name the remaining violations.

| Module | Purpose | May import | Must not import | Owns persistence |
|---|---|---|---|---|
| `shared/` (top level) | Wire contracts shared with `extensions/` (sync payload, command and bridge protocols, wire messages) | `zod` | anything under `src/`, `extensions/src` | no |
| `src/env.ts` / `src/env.public.ts` | Typed env: server-only / client-only. The single readers of `process.env` / `import.meta.env` for owned vars | — | — | no |
| `src/lib/shared` | Errors, Result wrappers, chunking, concurrency, `cn` | — | every other `src/lib` module | no |
| `src/lib/data` | Supabase client, URL guard, generated types | `env` | everything else | infra only |
| `src/lib/observability` | Logger, Sentry, PostHog (client + server), product events | `shared`, `env` | domains, features | no |
| `src/lib/integrations` | External provider adapters (LLM, reranker, ReccoBeats, Last.fm, youtube-audio, ML providers) | `shared`, `observability`, `env` | domains, platform, workflows, server | no |
| `src/lib/platform` | Cross-cutting capabilities: auth, jobs (`job` table transitions, progress parsing, active-jobs read model), email, rate-limit, routing | `data`, `shared`, `observability`, `integrations`, `domains/library/accounts` (identity) | workflows, server, features, worker | `job`, `job_item_failure`, auth tables |
| `src/lib/domains/<ctx>` | Bounded contexts: `library`, `enrichment`, `matching` (today `taste`), `billing`, `playlist-studio` (today `playlists`). Queries + pure logic for that context | `data`, `shared`, `integrations`, `observability`, `platform` (types, enqueue), `account-events/producer`, other domains' queries and types | workflows, server, features, worker | yes, primary owner of every table it names |
| `src/lib/account-events` | SSE event contract, token, producer (`writeAccountEvent(tx)`) | `data`, `shared`, domain/platform types | server, features | account-event outbox |
| `src/lib/workflows` | Cross-domain orchestration: enrichment, match-snapshot-refresh, library-processing (reconciler + state table), billing fan-out, extension/spotify sync, playlist studio | `domains`, `platform`, `integrations`, `observability`, `shared`, `account-events`, `shared/` | server, features, routes, worker; direct table access except its own state table | `library_processing_state` only |
| `src/lib/server` | Server-fn boundary (`*.functions.ts`) + request helpers (`request-body`, `extension-auth`, `extension-cors`). Auth, Zod edge parse, Result→throw, `captureServerError` | `workflows`, `domains`, `platform`, `account-events`, `content`, `observability`, `shared` | features, routes, worker; table queries (call a domain) | no |
| `src/lib/content` | Static, legal and landing content | `shared`, domain read types | features, data | no |
| Client infra: `src/lib/{extension,hooks,consent,keyboard,theme,navigation,config}` + `src/lib/query-keys.ts` | Browser-side app infrastructure: extension bridge, providers, generic hooks, cache keys and invalidation sets | `server` (fn calls), `shared/`, `components`, `theme`, `shared`, `observability` (client), domain types | features, `data` client, workflows, integrations, `src/env.ts` | no |
| `src/components` | App-wide UI primitives | `theme`, `shared`, client infra | features, server | no |
| `src/features/<name>` | Product UI per feature + its `queries.ts` (TanStack `queryOptions`) | `components`, client infra, `server` (fn calls), `content`, domain types and pure modules, allow-listed sibling features | `data` client, workflows, integrations, platform server modules, `src/env.ts` | no |
| `src/routes` (pages) | Route components, loaders, guards | features, components, client infra, server | data, workflows, domains (except pure helpers) | no |
| `src/routes/api/**` | HTTP endpoints (extension API, bridge, health) | same as `src/lib/server` | features | no |
| `src/worker` | Bun host: pollers, sweep, gateway, job runners/settlement shells, instrumentation, worker config | `workflows`, `domains`, `platform`, `account-events`, `observability`, `data`, `shared` | server, features, routes | via domains/platform |
| `src/integrations` | Framework wiring: TanStack Query provider and devtools, uipane dev adapter (vite alias) | framework libs | `src/lib/domains`, workflows | no |
| `src/test`, `src/__mocks__`, `src/stories` | Test utils and fixtures (`src/test/fixtures.ts` is canonical; `domains/{playlists,billing}/fixtures.ts` should move there), Ladle stubs, stories | anything | must not be imported by production code | no |

**Rules to keep or add under the table:**

1. `src/lib/data` is infrastructure-only *(keep)*.
2. Persistence lives with the owning concept. A workflow may own only its own state table. Server fns, routes and features call a domain/platform query instead of querying *(tightened)*.
3. Static content lives under `src/lib/content/` *(keep)*.
4. No barrel exports *(keep; two violations today)*.
5. Domain code returns `Result`. Only the server-fn boundary, `routes/api/**` handlers and the worker job runner throw or capture. Result→throw keeps `{ cause }`; any swallowed or degraded error is captured *(new; #4)*.
6. DB-derived id sets never re-enter as `.in()`. `chunkedRead` is for externally sourced ids only *(moved here from CLAUDE.md so it sits next to the persistence rule)*.
7. A status column has one owning module, and every transition is compare-and-set with a per-claim fence (attempts bump or claim token) *(new; #1, #7)*.
8. The import rules R1–R7 are enforced in `biome.json` and `vite.config.ts`. This table and the config must change together *(new)*.
