# Orchestration Decisions — Deepening & Cleanup Pass

Run start commit: `ad9ba6c5`
Plan: 5 deepening items + 4 smaller cleanups (pasted inline via `/orchestrate`).

This log records every decision that wasn't spelled out in the plan, with a one-line rationale.

## Settled up front (from analysis + evidence)

- **control-panel self-containment (affects #1 and #5): SHARED MODULE via `@/` import.**
  Rationale: control-panel has no package.json, is local-only tooling ("never deployed"), its tsconfig already aliases `@/* → ../src/*`, and it already imports pure product modules (wakeEnrichmentForSong, billing, data client, email). `url.ts`/`types.ts` are env-free pure modules — the "self-contained" comments are about avoiding the `@/env` graph, not an absolute rule. Copy-plus-validate rejected as unnecessary.

- **#2 readiness degradation: TWO named policies, not one.**
  Rationale: the four inline sites are *legitimately* opposite — `jobs.functions.ts` degrades to `false` (UI must not lie about readiness); scheduler/playlists degrade to `true` (don't spam bootstrap/interactive priority on transient DB errors). Flattening to one policy would be wrong. Module exports `resolveReadinessConservative` (→false) and `resolveReadinessPermissive` (→true).

- **#2 empty-state Reason union: export 6 live values.**
  `deriveEmptyStateReason` owns the 6 produced values (no-context, building, building-more, caught-up, none-yet, filtered). `no-matches`/`all-decided` are dead/legacy in MatchingEmptyState.tsx and are NOT re-exposed by the new exported type.

## User decisions (via AskUserQuestion)

- **`changes/` constructor pattern: LEFT AS-IS (skipped).**
  Rationale: analysis showed the plan's "half-applied" premise is false — all 13 change kinds are covered and every file is a consistent zero-logic named constructor. Inlining would be pure churn across many call sites for near-zero benefit. User chose "Leave as-is".

- **`"normal"` selection-mode default: FULL CONSOLIDATION.**
  Rationale: user chose full consolidation. Keep the canonical backward-compat default at `parse.ts:70`; remove the 2 unreachable `?? "normal"` guards in execute.ts AND the interior param defaults (orchestrator.ts, batch.ts), making selectionMode explicit down the chain. Single source of truth.

## Per-task deviations (appended during execution)

<!-- subagents append below -->

- **Change A — `parseYoutubeUrl` call sites: NO ADAPTATION NEEDED.** Return shape of `extractYoutubeVideoId` (`{ videoId, canonicalUrl }`) is identical to the local `parseYoutubeUrl` it replaced; only the import and function name changed. Error message updated to include `m.youtube.com` to match the now-broader accepted host set.

- **Change B — `reviews.ts` pre-existing tsconfig warning noted.** `bunx tsgo -p control-panel/tsconfig.json --noEmit` surfaces a pre-existing TS5102 error (`baseUrl` removed from tsconfig, commit `fe80bdf6`). Not introduced by this change; not touched.

- **Scored-candidate JSONB contract — schema field nullability.** Derived from `toCandidateSnapshots` in `scoring.ts` (the authoritative writer) and `YoutubeCandidate`/`ScoredCandidate` in `types.ts`. Required non-null: `videoId`, `url`, `title` (all `string` on `YoutubeCandidate`), `score` (`number` on `ScoredCandidate`), `reasons` (`string[]`), `rejected` (`boolean`). Nullable: `channel` (`string | null`), `durationSeconds` (`number | null`), `thumbnailUrl` (`string | null`), `rejectReason` (`string | null` via `?? null`), `rank` (`number | null` for rejected candidates). No blanket-nullable — only fields the writer can actually emit as null are typed nullable, so a writer rename/drop produces a parse error at the read seam.

- **Read-path validation strategy: log-and-skip per item, not throw.** `asCandidates` in `control-panel/server/audio-candidates.ts` uses `safeParse` per candidate and logs + skips failures. Throw-per-item was rejected because `asCandidates` is called once per row during `listAudioReviews`/`listAudioFeatureJobs`; a single bad candidate would kill the entire operator list — the operator couldn't see any other jobs. Log-and-skip surfaces schema drift loudly in server logs while preserving UI function for valid data. A total-array failure (not an array, or not parseable JSON) still returns `[]`, which was the previous behaviour.

- **`rejectedCandidates` in `SettleBackfillInput` updated to `MatchCandidateSnapshot[]`.** The legacy compact shape (`{ videoId, title, reason }`) produced in `service.ts` was replaced with `toCandidateSnapshots(source.scored.filter(s => s.rejected))`, which emits the same full 11-field snapshot that the `candidates` column already stores. `rejectedCandidates` and `candidates` now carry the same schema; the rejected subset stays separately addressable via the JSONB column for DB-side queries without `->` filtering. The `as unknown as Json` cast is kept only at the RPC argument boundary in `settleBackfillJob` / `markJobManualNeeded`.

- **Queue priority band unification — `QueueBand`/`BillingBand` single home in `band-policy.ts`.** `band-policy.ts` is the canonical vocabulary module (`src/lib/workflows/library-processing/band-policy.ts`). `billing/state.ts` imports `BillingBand` from there (`import type { BillingBand }`); `billing/queries.ts` imports it directly rather than via `state.ts` to avoid a barrel re-export. This puts a workflow module in the billing domain's import graph — an unusual layering direction — but is correct: `BillingBand` is inherently a scheduler-facing concept (it's what the scheduler uses to decide queue priority), and billing is a producer of it, not its definer. `"interactive"` is expressed as absent from `BillingBand = Exclude<QueueBand, "interactive">`, which makes "billing can't produce interactive" a type-level fact, not just a code comment.

- **Enrichment band policy: named Set + function, not exhaustive Record.** The sibling `MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE` table is exhaustive because every change kind maps to a static number. For enrichment band, most change kinds return a *runtime* value (`billingBand`), not a constant. An exhaustive `Record<LibraryProcessingChange["kind"], ...>` would require a different encoding to express "pass through billingBand" (e.g. `null | "priority"`), making the table harder to read and requiring a second step to resolve. A named `Set` of override kinds (`ENRICHMENT_PRIORITY_OVERRIDE_KINDS`) plus `resolveEnrichmentBand(billingBand, changeKind)` is simpler and equally extensible: adding a new prioritized kind is one line in the Set. Refresh band is flag-driven (not change-kind-driven), so a function accepting `{ isFirstVisibleBootstrap }` is the natural shape for both policy and test assertion.

- **Readiness module re-exports the probe (does not move it).** `hasFirstVisibleReviewSubject` stays in `service.ts` (it has internal callers there); `readiness.ts` re-exports it alongside the two named resolvers to avoid a circular dependency. Two policies, not one: `resolveReadinessConservative` (error⇒false, UI/`jobs.functions.ts`) and `resolveReadinessPermissive` (error⇒true, scheduler both arms + `playlists.functions.ts`) — the opposite error defaults are legitimate and preserved exactly.

- **`MatchingEmptyState` keeps a local `ComponentReason` alias.** The exported `Reason` (in `queue-helpers.ts`) is the 6 live values only. The component's static-copy map still references the dead `"no-matches"`/`"all-decided"` labels, so a file-local `ComponentReason = Reason | "no-matches" | "all-decided"` keeps them typed without exposing dead states through the exported union. Both dead values are unreachable from live code (verified: they appear only in the copy map).

- **DEFERRED (noted): scheduler cross-invocation double-probe not eliminated.** The plan wanted the scheduler to probe readiness once per change. Investigation (implementer + review) showed a single `executeEffect` call already probes at most once (the enrichment and refresh arms are mutually exclusive, enrichment returns early). The remaining duplication is *cross-invocation*: a change that dispatches BOTH an enrichment effect and a refresh effect calls `executeEffect` twice ⇒ 2 probes. Truly deduping that requires lifting the probe above the per-effect dispatch and threading it in — a more invasive change to effect dispatch. It was deferred as a non-blocking optimization (behavior is correct; the DB read is cheap). The code-quality win (named policies, no duplicated inline degradation logic, single hoisted probe per call) is captured. Recommend a follow-up if the both-effects-per-change path becomes hot.

- **Task 4 patch: merged a duplicate import** in `useActiveJobs.test.ts` (two `import ... from "@/features/matching/queries"` statements) into one — a biome/CI-blocking lint error the implementer left behind.

- **Review-card derivation extracted to `src/lib/server/match-review-queue.read.ts` (server layer, not domain).** Placing it in `src/lib/domains/taste/...` would pull a `src/lib/server` import (`MatchingSong`/`MatchingPlaylistMatch` from `matching.functions.ts`) into the domain layer, inverting the dependency direction — so it stays server→server. The extraction is a pure `mapSongOrientationRows(...)` (unit-testable, no supabase) + a thin `fetchSongOrientationData(...)` wrapper doing the Promise.all. The read module returns typed statuses (`missing-song`/`playlist-error`) and each handler maps them to ITS OWN user-facing message (get: "Could not load playlist data."; present: "Couldn't load this match card. Try again.") — the two genuinely-different messages were preserved.

- **Unconditional `visibleRank` sort in the pure mapper is behavior-preserving.** `getMatchReviewItem` previously iterated `list.suggestions` without sorting; the mapper now always sorts by `visibleRank` asc. Verified safe: `computeVisibleSuggestionList`/`deriveVisibleSuggestions` assigns `visibleRank` as a monotonic counter in output order, so its result is already `visibleRank`-ascending — the sort is idempotent for the get/captured paths and is the correct fix for present's `already_captured` path (DB returns pairs in arbitrary order). Uses `captureServerError` directly instead of the private `reportQueueError` (kept in functions.ts for its other error paths).

- **"normal" default: full consolidation re-routed `execute.ts` through the canonical `parseJobProgress` (approved scope expansion).** The task was to remove 4 redundant defaults, but `execute.ts`'s `progress` was `Partial<EnrichmentChunkProgress>`, so its two `?? "normal"` guards were load-bearing, not dead. Rather than a cast/assertion, the fix routes `execute.ts` through `parseJobProgress("enrichment", ...)` — the SAME canonical reader already used in `jobs.functions.ts:95` — which fills all defaults (incl. selectionMode) via `fillEnrichmentDefaults`, so `progress.selectionMode` is non-optional and the guards drop cleanly. Two consequent behavior changes, both reviewed safe: (1) a non-object/corrupted `job.progress` now THROWS instead of silently falling back to `{}` defaults — unreachable for any real/partial enrichment row (all writers persist valid objects), and surfacing corruption is an improvement; (2) `batchSize ?? 1` → `|| 1` because `fillEnrichmentDefaults` uses 0 as the "absent" sentinel (real batch sizes are always ≥1, so equivalent). `parse.ts` and `makeInitialProgress` stay unchanged as the two legitimate defaults. `executeWorkerChunk`/`selectEnrichmentWorkPlan` params became required; all callers (incl. ~25 test call sites) pass an explicit "normal" preserving prior behavior.

- **Minor (noted, not fixed): a redundant duplicate test remains in `batch.test.ts`.** After the `mode` param became required, the old "calls the normal RPC when mode is omitted (default)" test was renamed and is now identical to the adjacent "mode is 'normal'" test. Kept both per the project rule against deleting/skipping tests; harmless redundancy. Candidate for a one-line manual cleanup later.

- **Skipped cleanup (per user decision): `changes/` constructor pattern left as-is** — the plan's "half-applied" premise was false (all 13 change kinds covered, uniformly zero-logic); inlining would be pure churn. No code change made.

- **Deferred (noted): relocating `QueueBand`/`BillingBand` to a foundational module.** Task 3 review's non-blocking recommendation — move the two vocabulary types out of `workflows/library-processing/band-policy.ts` into a neutral module so `billing/` no longer imports from a workflow module. Not done (respecting the plan's chosen placement + "build only what's asked"); recorded as a future follow-up.

## Follow-ups (completed after the main run, at user request)

- **[DONE] Duplicate test removed** (`batch.test.ts`) — the rename-artifact duplicate of "calls the normal RPC when mode is 'normal'" was removed (byte-for-byte identical, zero coverage loss). Commit `43b30bd4`.

- **[DONE] `QueueBand`/`BillingBand` relocated to `src/lib/shared/queue/band.ts`** — the layering inversion is resolved; `billing/` no longer imports the band vocabulary from `workflows/`. Policy functions stay in `band-policy.ts`. New `shared/queue/` subdir mirrors the existing `shared/errors/` + `shared/utils/` convention. madge-confirmed no cycle. Commit `96a584eb`.

- **[DONE] Scheduler cross-invocation double-probe eliminated** — `createReadinessAccessor(accountId)` (a per-change, lazy, memoized `() => Promise<boolean>` that bakes in `resolveReadinessPermissive`) is created once per change in `applyLibraryProcessingChange` and threaded into `executeEffect`. A change dispatching both effects now probes readiness exactly once (proven by a probe-count test); a change needing neither arm probes zero times (lazy by construction). accountId substitution (`change.accountId` for the old `effect.accountId`) verified provably safe: effects carry `state.accountId`, and state is loaded by `change.accountId`, so they're always equal. Behavior preserved. Commit pending.
