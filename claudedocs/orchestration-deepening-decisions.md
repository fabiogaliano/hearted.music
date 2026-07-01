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
