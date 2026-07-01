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
